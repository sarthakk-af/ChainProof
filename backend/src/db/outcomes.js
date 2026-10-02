import { db } from "./connection.js";

/**
 * outcomes.js — the mirror of DriveOutcomes: stages, offer answers, placements.
 *
 * All written by the indexer from chain events. Nothing here is ever updated in
 * place, because nothing on-chain is: a withdrawn offer is a new stage record
 * superseding an old one, and the history stays readable. Updating a row would
 * throw away exactly the thing that makes this worth putting on a chain.
 */

export function addOutcome(outcome) {
  db.prepare(
    `INSERT INTO drive_outcomes
       (drive_id, student_address, stage, previous_stage, label, ipfs_hash, timestamp, block_number)
     VALUES (@driveId, @studentAddress, @stage, @previousStage, @label, @ipfsHash, @timestamp, @blockNumber)
     ON CONFLICT DO NOTHING`
  ).run({ ...outcome, studentAddress: outcome.studentAddress.toLowerCase() });
}

/**
 * Every stage recorded for a student in a drive, oldest first.
 * @dev Ordered by block, not by row id. Rows are inserted in whatever order
 *      the mirror happened to process them — a block that failed and was
 *      repaired later lands after newer ones — so the id says nothing about
 *      when the stage was recorded on-chain.
 */
export function getOutcomeHistory(driveId, studentAddress) {
  return db
    .prepare(
      `SELECT * FROM drive_outcomes
        WHERE drive_id = ? AND LOWER(student_address) = LOWER(?)
        ORDER BY block_number ASC, id ASC`
    )
    .all(driveId, studentAddress);
}

/** The stage currently standing for each student in a drive — the latest on-chain. */
export function getCurrentStages(driveId) {
  return db
    .prepare(
      `SELECT student_address, stage, label, timestamp
         FROM drive_outcomes o
        WHERE drive_id = ?
          AND id = (
            SELECT id FROM drive_outcomes
             WHERE drive_id = o.drive_id AND student_address = o.student_address
             ORDER BY block_number DESC, id DESC
             LIMIT 1
          )`
    )
    .all(driveId);
}

export function setOfferResponse({ driveId, studentAddress, response, timestamp, blockNumber }) {
  db.prepare(
    `INSERT INTO offer_responses (drive_id, student_address, response, timestamp, block_number)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(drive_id, student_address) DO UPDATE SET
       response     = excluded.response,
       timestamp    = excluded.timestamp,
       block_number = excluded.block_number`
  ).run(driveId, studentAddress.toLowerCase(), response, timestamp, blockNumber);
}

/**
 * Forgets an answer that belonged to an earlier offer.
 * @dev The contract clears its answer when the company makes the offer again —
 *      the new offer is a new question. Only an answer from an earlier block is
 *      cleared: the mirror may see a re-offer after the answer to it, and that
 *      answer is the one that stands.
 */
export function clearOfferResponseBefore(driveId, studentAddress, blockNumber) {
  db.prepare(
    `DELETE FROM offer_responses
      WHERE drive_id = ? AND LOWER(student_address) = LOWER(?) AND block_number < ?`
  ).run(driveId, studentAddress, blockNumber);
}

export function getOfferResponse(driveId, studentAddress) {
  return db
    .prepare(
      "SELECT * FROM offer_responses WHERE drive_id = ? AND LOWER(student_address) = LOWER(?)"
    )
    .get(driveId, studentAddress);
}

// --- placements --------------------------------------------------------------

/**
 * Records a placement change.
 * @dev `placed` is stored rather than inferred so the mirror matches the
 *      contract's own answer exactly. Deriving it here would be a second
 *      implementation of the same rule, and two implementations eventually
 *      disagree.
 */
export function setPlacement({ studentAddress, collegeAddress, batchYear, placed, blockNumber }) {
  db.prepare(
    `INSERT INTO placements (student_address, college_address, batch_year, placed, block_number)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(student_address) DO UPDATE SET
       college_address = excluded.college_address,
       batch_year      = excluded.batch_year,
       placed          = excluded.placed,
       block_number    = excluded.block_number`
  ).run(
    studentAddress.toLowerCase(),
    collegeAddress.toLowerCase(),
    batchYear,
    placed ? 1 : 0,
    blockNumber
  );
}

export function isPlaced(studentAddress) {
  const row = db
    .prepare("SELECT placed FROM placements WHERE LOWER(student_address) = LOWER(?)")
    .get(studentAddress);
  return !!row?.placed;
}
