import { db } from "./connection.js";

/**
 * roster.js — the college's own list of who its students are.
 *
 * This is how the platform answers "is this person really from here?". A signup
 * claims an unclaimed row and nothing else admits a student, so the answer is
 * the college's own record rather than anything the student typed. A roll number
 * that isn't on the list cannot be invented.
 *
 * Claiming is deliberately a single conditional UPDATE. Two people submitting the
 * same roll number at the same moment would both pass a read-then-write check —
 * the same race that has appeared in registration, approval and correction — so
 * the condition is evaluated inside the write and the loser sees zero rows
 * changed.
 */

/** Adds or replaces roster rows for a college. Returns counts of each. */
export function upsertRosterEntries(collegeAddress, entries) {
  const college = collegeAddress.toLowerCase();
  const now = Date.now();

  const existing = db.prepare(
    "SELECT roll_number, claimed_by FROM roster_entries WHERE college_address = ?"
  );
  const insert = db.prepare(
    `INSERT INTO roster_entries
       (college_address, roll_number, full_name, course_code, batch_year, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(college_address, roll_number) DO UPDATE SET
       full_name   = excluded.full_name,
       course_code = excluded.course_code,
       batch_year  = excluded.batch_year`
  );

  const run = db.transaction(() => {
    const claimed = new Set(
      existing
        .all(college)
        .filter((r) => r.claimed_by)
        .map((r) => r.roll_number)
    );
    let added = 0;
    let updated = 0;
    const skipped = [];

    for (const entry of entries) {
      // A claimed row is never rewritten. Someone is already using it, and
      // changing the name or course under them would silently alter who a real
      // account says it belongs to.
      if (claimed.has(entry.roll_number)) {
        skipped.push(entry.roll_number);
        continue;
      }
      const before = db
        .prepare("SELECT 1 FROM roster_entries WHERE college_address = ? AND roll_number = ?")
        .get(college, entry.roll_number);
      insert.run(
        college,
        entry.roll_number,
        entry.full_name,
        entry.course_code,
        entry.batch_year,
        now
      );
      if (before) updated++;
      else added++;
    }
    return { added, updated, skipped };
  });

  return run();
}

export function getRosterEntry(collegeAddress, rollNumber) {
  return db
    .prepare("SELECT * FROM roster_entries WHERE college_address = ? AND roll_number = ?")
    .get(collegeAddress.toLowerCase(), rollNumber);
}

/**
 * Claims a roll number for an address.
 * @returns {boolean} true if this call claimed it; false if it was already taken.
 */
export function claimRosterEntry(collegeAddress, rollNumber, address) {
  const result = db
    .prepare(
      `UPDATE roster_entries
          SET claimed_by = ?, claimed_at = ?
        WHERE college_address = ? AND roll_number = ? AND claimed_by IS NULL`
    )
    .run(address.toLowerCase(), Date.now(), collegeAddress.toLowerCase(), rollNumber);
  return result.changes === 1;
}

/** Releases whatever roll number this address holds — used when registration fails. */
export function releaseRosterClaim(address) {
  db.prepare(
    "UPDATE roster_entries SET claimed_by = NULL, claimed_at = NULL WHERE LOWER(claimed_by) = LOWER(?)"
  ).run(address);
}

export function getRosterEntryForAddress(address) {
  return db
    .prepare("SELECT * FROM roster_entries WHERE LOWER(claimed_by) = LOWER(?)")
    .get(address);
}

export function listRoster(collegeAddress, { batchYear } = {}) {
  if (batchYear === undefined || batchYear === null) {
    return db
      .prepare("SELECT * FROM roster_entries WHERE college_address = ? ORDER BY roll_number")
      .all(collegeAddress.toLowerCase());
  }
  return db
    .prepare(
      "SELECT * FROM roster_entries WHERE college_address = ? AND batch_year = ? ORDER BY roll_number"
    )
    .all(collegeAddress.toLowerCase(), batchYear);
}

/**
 * How many roster rows exist per cohort, and how many have been claimed.
 * @dev The gap between these two is the opt-in rate — how many students the
 *      college listed versus how many actually signed up — which is worth
 *      showing next to a placement percentage rather than leaving implicit.
 */
export function rosterCounts(collegeAddress) {
  return db
    .prepare(
      `SELECT course_code, batch_year,
              COUNT(*) AS listed,
              SUM(CASE WHEN claimed_by IS NOT NULL THEN 1 ELSE 0 END) AS claimed
         FROM roster_entries
        WHERE college_address = ?
        GROUP BY course_code, batch_year`
    )
    .all(collegeAddress.toLowerCase());
}
