import { db } from "./connection.js";
import { normalizeEmail } from "../limits.js";

/**
 * Email addresses are matched case-insensitively, and stored lowercased.
 *
 * Mail domains don't distinguish case in practice, so Sarthak@Gmail.com and
 * sarthak@gmail.com are one inbox and must be one account. Without this they
 * were two: two custodial wallets, two gas drips from the treasury, and a user
 * who signed up with one capitalisation and typed another at login got
 * "invalid credentials" with no way to work out why — /forgot-password would
 * also silently fail for them, since it deliberately never reveals whether an
 * address is registered.
 *
 * Normalising here rather than at each route means every lookup path —
 * signup, login, OTP, resend, reset, check-email — gets it for free and can't
 * drift apart later.
 */
export { normalizeEmail } from "../limits.js";

export function createUser({ email, passwordHash, walletAddress, encryptedPrivateKey }) {
  const result = db
    .prepare(
      `INSERT INTO users (email, password_hash, wallet_address, encrypted_private_key, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(normalizeEmail(email), passwordHash, walletAddress, encryptedPrivateKey, Date.now());
  return getUserById(result.lastInsertRowid);
}

export function getUserByEmail(email) {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(normalizeEmail(email));
}

/** The account that holds a wallet address, for the college's roster view. */
export function getUserByAddress(address) {
  return db
    .prepare("SELECT * FROM users WHERE LOWER(wallet_address) = LOWER(?)")
    .get(String(address ?? ""));
}

export function getUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

/**
 * Removes an account that was never finished.
 *
 * Signup takes the row before spending gas on its wallet, so that a second
 * signup for the same email is refused by the UNIQUE constraint rather than by
 * a check the first one can slip past. If funding then fails there is nothing
 * to keep, and a half-made account would block the address for good.
 */
export function deleteUser(userId) {
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
}

export function setPasswordHash(userId, passwordHash) {
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, userId);
}

export function setEmailVerified(userId) {
  db.prepare("UPDATE users SET email_verified = 1 WHERE id = ?").run(userId);
}

/**
 * Invalidates every previously-issued token for this user (see userAuth.js,
 * which rejects any token whose embedded version doesn't match this one).
 * Called on logout and on a successful password reset.
 */
export function bumpTokenVersion(userId) {
  db.prepare("UPDATE users SET token_version = token_version + 1 WHERE id = ?").run(userId);
}

// =========================================================================
// Password resets
// =========================================================================

/** `tokenHash` is the only thing stored — the raw token is emailed, never persisted. */
export function createPasswordReset({ tokenHash, userId, expiresAt }) {
  db.prepare(
    "INSERT INTO password_resets (token_hash, user_id, expires_at, used) VALUES (?, ?, ?, 0)"
  ).run(tokenHash, userId, expiresAt);
}

export function getPasswordReset(tokenHash) {
  return db.prepare("SELECT * FROM password_resets WHERE token_hash = ?").get(tokenHash);
}

/**
 * Marks every outstanding reset token for a user as used. Called after a
 * successful reset — otherwise, requesting "forgot password" more than once
 * (e.g. because the first email was slow to arrive) leaves multiple valid
 * links, any of which could still reset the password again within the hour
 * even after the account owner already completed a reset with one of them.
 */
export function invalidateAllPasswordResetsForUser(userId) {
  db.prepare("UPDATE password_resets SET used = 1 WHERE user_id = ?").run(userId);
}
