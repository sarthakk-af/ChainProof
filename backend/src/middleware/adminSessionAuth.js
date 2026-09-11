import { verifyAdminToken } from "../auth.js";
import { getAdminById } from "../db.js";

/**
 * Guards the actual verification-queue actions (list/approve/reject) with a
 * real admin session, not the shared bootstrap secret — see adminAuth.js for
 * that secret's narrower remaining role. Attaches `req.admin` so every
 * action can record exactly which admin performed it.
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

  const admin = getAdminById(payload.sub);
  if (!admin) {
    return res.status(401).json({ error: "This admin account no longer exists." });
  }

  req.admin = { id: admin.id, username: admin.username };
  next();
}
