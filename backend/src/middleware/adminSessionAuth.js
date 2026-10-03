import { verifyAdminToken } from "../auth.js";
import { db } from "../db.js";

/**
 * Guards the platform-owner routes.
 *
 * Admin tokens are a separate type from user sessions (`type: "admin"`), and
 * `verifyAdminToken` refuses anything else. The reverse is guarded too, in
 * userAuth — both tokens are signed with the same secret, and an admin token's
 * `sub` is an admins-table id which, being a small autoincrement integer,
 * usually also names a real and unrelated user.
 */
export function adminSessionAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Missing admin session token" });
  }

  const payload = verifyAdminToken(token);
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired admin session. Please log in again." });
  }

  const admin = db.prepare("SELECT id, username, token_version FROM admins WHERE id = ?").get(payload.sub);
  if (!admin) {
    return res.status(401).json({ error: "This admin account no longer exists." });
  }
  // Signing out, or a change of ADMIN_PASSWORD, bumps the version and ends
  // every session issued before it.
  if ((payload.tokenVersion ?? 0) !== admin.token_version) {
    return res.status(401).json({ error: "This admin session has been signed out. Please log in again." });
  }

  req.admin = { id: admin.id, username: admin.username };
  next();
}
