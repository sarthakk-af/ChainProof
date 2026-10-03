import { db } from "./connection.js";

/**
 * erasure.js — deleting an account and everything personal held about it.
 *
 * The privacy page promised that off-chain data "can be changed or deleted",
 * and cited the right to erasure, but nothing deleted anything. This does.
 *
 * What goes: the login itself (email, password hash, the encrypted wallet key),
 * the profile, resume, skills, applications, and every pending code or token.
 * What stays, and why:
 *   - anything on-chain. It can't be erased; it is tied only to a wallet
 *     address, and with the login gone nothing here links that address to a
 *     person any more;
 *   - the college's roster row. It is the college's record of who its students
 *     are, not something the student wrote — only the claim on it is released;
 *   - an institution's registration number claim and the decision log, which
 *     describe organisations, not people.
 *
 * One transaction: a half-erased account is worse than either state.
 */
export const eraseAccount = db.transaction((user) => {
  const address = user.wallet_address.toLowerCase();
  const byAddress = (table, column = "address") =>
    db.prepare(`DELETE FROM ${table} WHERE LOWER(${column}) = ?`).run(address);
  const byUser = (table) => db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(user.id);

  byAddress("student_profiles");
  byAddress("student_resume_items");
  byAddress("student_skills");
  byAddress("applications", "student_address");
  db.prepare(
    "UPDATE roster_entries SET claimed_by = NULL, claimed_at = NULL WHERE LOWER(claimed_by) = ?"
  ).run(address);

  byUser("student_verifications");
  byUser("email_otps");
  byUser("password_resets");
  db.prepare("DELETE FROM idempotency_keys WHERE store_key LIKE ?").run(`${user.id}:%`);

  db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
});
