import { db } from "./connection.js";

/**
 * Public/aggregate stats — DB-only, no live chain calls, safe for anonymous
 * traffic since everything here is answered from the already-indexed cache.
 */

/**
 * Registered/placed student counts per College, computed in one grouped
 * query rather than one lookup per college.
 */
export function getPerCollegePlacementStats() {
  const rows = db
    .prepare(
      `SELECT a.college AS college_address,
              COUNT(DISTINCT a.address) AS registered,
              COUNT(DISTINCT CASE WHEN c.cred_type = 3 THEN a.address END) AS placed
       FROM actors a
       LEFT JOIN credentials c ON c.student_address = a.address
       WHERE a.role = 1 AND a.college IS NOT NULL
       GROUP BY a.college`
    )
    .all();
  return new Map(rows.map((r) => [r.college_address, r]));
}

/** Platform-wide count of distinct students with at least one Offer credential. */
export function countPlacedStudentsGlobal() {
  return db
    .prepare("SELECT COUNT(DISTINCT student_address) AS c FROM credentials WHERE cred_type = 3")
    .get().c;
}

/**
 * The individual on-chain records behind one college's placement percentage —
 * what a skeptical visitor drills into to check the number is real, without
 * publicly naming which student received which credential. Deliberately
 * shows the record (type, when, which verified issuer) and not student
 * identity — "verifiable" should mean checking the underlying activity is
 * real, not broadcasting a named student's personal outcome to the internet.
 */
export function getCollegeRecords(collegeAddress, limit = 100) {
  return db
    .prepare(
      `SELECT c.id, c.cred_type, c.timestamp, c.issuer_address,
              i.name AS issuer_name, i.role AS issuer_role
       FROM credentials c
       JOIN actors s ON s.address = c.student_address
       LEFT JOIN actors i ON i.address = c.issuer_address
       WHERE s.college = ?
       ORDER BY c.timestamp DESC
       LIMIT ?`
    )
    .all(collegeAddress, limit);
}
