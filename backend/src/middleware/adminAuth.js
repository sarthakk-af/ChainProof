import { config } from "../config.js";

/**
 * Guards the *bootstrap* admin action — creating a named admin account (see
 * routes/admin.js's POST /admins) — with a shared secret from the
 * environment. This is deliberately no longer used to guard the actual
 * verification-queue actions (list/approve/reject) — those require a real
 * per-admin session (see middleware/adminSessionAuth.js) so a decision can
 * be attributed to a specific person, not just "someone who has the key."
 * This secret's only remaining job is standing up the first admin account(s).
 */
export function adminAuth(req, res, next) {
  const key = req.get("x-admin-key");
  if (!key || key !== config.adminApiKey) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}
