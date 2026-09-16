import { db } from "./connection.js";

/**
 * batches.js — the mirror of ActorRegistry's declared cohort sizes.
 *
 * This is the denominator of every placement percentage, and the one figure the
 * college itself supplies. It is kept on-chain so a revision can never be quiet;
 * mirrored here with `previous_strength` and a revision count so the interface
 * can show "revised from 180" without re-reading the event log every time.
 */

export function upsertBatch({ collegeAddress, courseCode, batchYear, strength, previousStrength, blockNumber }) {
  db.prepare(
    `INSERT INTO batches
       (college_address, course_code, batch_year, strength, previous_strength, revision_count, block_number)
     VALUES (?, ?, ?, ?, ?, 0, ?)
     ON CONFLICT(college_address, course_code, batch_year) DO UPDATE SET
       strength          = excluded.strength,
       previous_strength = excluded.previous_strength,
       revision_count    = batches.revision_count + 1,
       block_number      = excluded.block_number`
  ).run(
    collegeAddress.toLowerCase(),
    courseCode,
    batchYear,
    strength,
    previousStrength ?? null,
    blockNumber
  );
}

export function getBatch(collegeAddress, courseCode, batchYear) {
  return db
    .prepare(
      "SELECT * FROM batches WHERE college_address = ? AND course_code = ? AND batch_year = ?"
    )
    .get(collegeAddress.toLowerCase(), courseCode, batchYear);
}

export function listBatches(collegeAddress, { batchYear } = {}) {
  if (batchYear === undefined || batchYear === null) {
    return db
      .prepare(
        "SELECT * FROM batches WHERE college_address = ? ORDER BY batch_year DESC, course_code"
      )
      .all(collegeAddress.toLowerCase());
  }
  return db
    .prepare(
      "SELECT * FROM batches WHERE college_address = ? AND batch_year = ? ORDER BY course_code"
    )
    .all(collegeAddress.toLowerCase(), batchYear);
}

/**
 * Total declared strength for a cohort year, across every course.
 * @dev The on-chain placement count is keyed by college and year, not by course,
 *      because a drive states a year and profiles are off-chain. Summing the
 *      per-course declarations is what makes the two comparable.
 */
export function totalStrengthForYear(collegeAddress, batchYear) {
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(strength), 0) AS total FROM batches WHERE college_address = ? AND batch_year = ?"
    )
    .get(collegeAddress.toLowerCase(), batchYear);
  return row.total;
}

/** Cohorts whose declared size has been revised at least once. */
export function revisedBatches(collegeAddress) {
  return db
    .prepare(
      "SELECT * FROM batches WHERE college_address = ? AND revision_count > 0 ORDER BY batch_year DESC"
    )
    .all(collegeAddress.toLowerCase());
}
