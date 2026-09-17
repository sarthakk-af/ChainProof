import { db } from "./connection.js";

/**
 * verifications.js — a student's claim to be a student of this college.
 *
 * The thing this exists to prevent is a dead end. Both orderings have to work:
 * someone who signs up after the roster is uploaded should be verified the
 * moment they type their roll number, and someone who signs up before it should
 * wait in a queue rather than be told no. The first build only handled the
 * first case, and the second was a wall with no way past it.
 */

export const VERIFICATION = { Pending: 0, Verified: 1, Rejected: 2 };

export function upsertVerification({ userId, address, collegeAddress, rollNumber, status, reason }) {
  db.prepare(
    `INSERT INTO student_verifications
       (user_id, address, college_address, roll_number, status, reason, created_at, decided_at)
     VALUES (@userId, @address, @collegeAddress, @rollNumber, @status, @reason, @now, @decidedAt)
     ON CONFLICT(user_id) DO UPDATE SET
       address         = excluded.address,
       college_address = excluded.college_address,
       roll_number     = excluded.roll_number,
       status          = excluded.status,
       reason          = excluded.reason,
       decided_at      = excluded.decided_at`
  ).run({
    userId,
    address: address.toLowerCase(),
    collegeAddress: collegeAddress.toLowerCase(),
    rollNumber,
    status: status ?? VERIFICATION.Pending,
    reason: reason ?? null,
    now: Date.now(),
    decidedAt: status === VERIFICATION.Pending || status === undefined ? null : Date.now(),
  });
}

export function getVerification(userId) {
  return db.prepare("SELECT * FROM student_verifications WHERE user_id = ?").get(userId);
}

export function setVerificationStatus(userId, status, reason = null) {
  db.prepare(
    "UPDATE student_verifications SET status = ?, reason = ?, decided_at = ? WHERE user_id = ?"
  ).run(status, reason, Date.now(), userId);
}

/** The queue the placement cell works through. */
export function listPendingVerifications(collegeAddress) {
  return db
    .prepare(
      `SELECT v.*, u.email
         FROM student_verifications v
         JOIN users u ON u.id = v.user_id
        WHERE v.college_address = ? AND v.status = ?
        ORDER BY v.created_at ASC`
    )
    .all(collegeAddress.toLowerCase(), VERIFICATION.Pending);
}

/**
 * Whether a roll number is already spoken for at this college.
 * @dev Covers both a claimed roster row and a *pending* request for the same
 *      number — otherwise two people could queue for the same roll number and
 *      the cell would approve both before noticing.
 */
export function rollNumberPending(collegeAddress, rollNumber, exceptUserId = null) {
  const row = db
    .prepare(
      `SELECT user_id FROM student_verifications
        WHERE college_address = ? AND roll_number = ? AND status = ?`
    )
    .get(collegeAddress.toLowerCase(), rollNumber, VERIFICATION.Pending);
  if (!row) return false;
  return exceptUserId === null || row.user_id !== exceptUserId;
}
