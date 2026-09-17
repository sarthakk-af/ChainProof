import { db } from "./connection.js";

/**
 * batches.js — the mirror of ActorRegistry's declared cohort sizes.
 *
 * This is the denominator of every placement percentage, and the one figure the
 * college itself supplies. It is kept on-chain so a revision can never be quiet;
 * mirrored here with `previous_strength` and a revision count so the interface
 * can show "revised from 180" without re-reading the event log every time.
 */

/**
 * Whether an incoming event is a genuine revision of what is already stored.
 *
 * Two conditions, both of which used to be missing:
 *   - the event is newer than the stored one. The same event arrives twice in
 *     normal operation — once when the route syncs its own receipt, and again
 *     from the live listener — and each arrival was counted, so a cohort that
 *     was declared once showed on the public page as "revised";
 *   - the size actually changed. Re-declaring 180 as 180 is not a revision, and
 *     telling parents it was would be exactly the kind of false signal this
 *     figure exists to prevent.
 */
const IS_REVISION =
  "excluded.block_number > batches.block_number AND excluded.strength <> batches.strength";

export function upsertBatch({ collegeAddress, courseCode, batchYear, strength, previousStrength, blockNumber }) {
  db.prepare(
    `INSERT INTO batches
       (college_address, course_code, batch_year, strength, previous_strength, revision_count, block_number)
     VALUES (?, ?, ?, ?, ?, 0, ?)
     ON CONFLICT(college_address, course_code, batch_year) DO UPDATE SET
       strength          = CASE WHEN excluded.block_number >= batches.block_number
                                THEN excluded.strength ELSE batches.strength END,
       previous_strength = CASE WHEN ${IS_REVISION} THEN excluded.previous_strength
                                ELSE batches.previous_strength END,
       revision_count    = batches.revision_count + CASE WHEN ${IS_REVISION} THEN 1 ELSE 0 END,
       block_number      = MAX(batches.block_number, excluded.block_number)`
  ).run(
    collegeAddress.toLowerCase(),
    courseCode,
    batchYear,
    strength,
    previousStrength ?? null,
    blockNumber
  );
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
