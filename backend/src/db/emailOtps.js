import { db } from "./connection.js";

/** Replaces any existing OTP for this user — only the most recently sent code is ever valid. */
export function setEmailOtp({ userId, otpHash, expiresAt }) {
  db.prepare(
    `INSERT INTO email_otps (user_id, otp_hash, expires_at, attempts, created_at)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       otp_hash = excluded.otp_hash,
       expires_at = excluded.expires_at,
       attempts = 0,
       created_at = excluded.created_at`
  ).run(userId, otpHash, expiresAt, Date.now());
}

export function getEmailOtp(userId) {
  return db.prepare("SELECT * FROM email_otps WHERE user_id = ?").get(userId);
}

export function incrementOtpAttempts(userId) {
  db.prepare("UPDATE email_otps SET attempts = attempts + 1 WHERE user_id = ?").run(userId);
}

export function deleteEmailOtp(userId) {
  db.prepare("DELETE FROM email_otps WHERE user_id = ?").run(userId);
}
