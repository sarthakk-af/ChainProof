import { verifyToken } from "../auth.js";
import { getUserById } from "../db.js";

/**
 * Verifies the `Authorization: Bearer <jwt>` header and attaches `req.user`.
 *
 * Also checks the token's embedded version against the user's current
 * token_version in the database — this is what makes logout (and a password
 * reset) actually invalidate a token, instead of it staying valid until it
 * naturally expires. See db/users.js's bumpTokenVersion.
 */
export function userAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Missing bearer token" });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  const user = getUserById(payload.sub);
  if (!user || user.token_version !== payload.tokenVersion) {
    return res.status(401).json({ error: "Session has been signed out. Please log in again." });
  }

  req.user = { id: payload.sub, address: payload.address };
  next();
}
