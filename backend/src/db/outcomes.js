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

/** Every stage recorded for a student in a drive, oldest first. */
export function getOutcomeHistory(driveId, studentAddress) {
  return db
    .prepare(
      `SELECT * FROM drive_outcomes
        WHERE drive_id = ? AND LOWER(student_address) = LOWER(?)
        ORDER BY id ASC`
    )
    .all(driveId, studentAddress);
}

/** The stage currently standing for each student in a drive. */
export function getCurrentStages(driveId) {
  return db
    .prepare(
      `SELECT student_address, stage, label, timestamp
         FROM drive_outcomes o
        WHERE drive_id = ?
          AND id = (
            SELECT MAX(id) FROM drive_outcomes
             WHERE drive_id = o.drive_id AND student_address = o.student_address
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
