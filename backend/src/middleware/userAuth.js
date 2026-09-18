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
  // Both token types are signed with the same secret, and an admin token's
  // `sub` is an admins-table id — which, being a small autoincrement integer,
  // usually also names a real and unrelated row in the users table. Today the
  // tokenVersion comparison below happens to reject it (an admin token has no
  // tokenVersion, and undefined never equals a number), but relying on that
  // accident means a later change to that check silently turns an admin
  // session into someone else's user session. Refuse it on type instead.
  if (payload.type === "admin") {
    return res.status(401).json({ error: "Admin sessions can't be used as user sessions." });
  }

  const user = getUserById(payload.sub);
  if (!user || user.token_version !== payload.tokenVersion) {
    return res.status(401).json({ error: "Session has been signed out. Please log in again." });
  }

  // The address comes from the row that was just loaded, not from the token.
  // Both are written by signToken and have always agreed, but authorization
  // reads the address while signing reads the id — so they must be the same
  // account by construction, not by convention.
  req.user = { id: user.id, address: user.wallet_address };
  next();
}
