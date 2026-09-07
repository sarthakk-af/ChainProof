import { config } from "../config.js";

/**
 * Guards the /admin routes with a shared-secret header. Appropriate for the
 * current single-admin, solo-dev stage; swap for real session/user auth once
 * more than one person needs admin access.
 */
export function adminAuth(req, res, next) {
  const key = req.get("x-admin-key");
  if (!key || key !== config.adminApiKey) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}
