import { db } from "./connection.js";

/**
 * Records one decision — see connection.js's admin_actions table comment for
 * why this exists.
 *
 * `decidedBy` is the wallet that made the decision: a college's address for a
 * company or drive decision, and null for the platform owner, who signs with
 * the verifier. It exists so a college can be shown its own record without
 * being shown the owner's, which is what the unfiltered list did.
 */
export function logAdminAction({ actorAddress, actorName, action, reason, txHash, adminUsername, decidedBy }) {
  db.prepare(
    `INSERT INTO admin_actions
       (actor_address, actor_name, action, reason, tx_hash, admin_username, decided_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    actorAddress,
    actorName || null,
    action,
    reason || null,
    txHash || null,
    adminUsername || null,
    decidedBy ? decidedBy.toLowerCase() : null,
    Date.now()
  );
}

/**
 * The most recent decisions, newest first.
 * @param {number} limit
 * @param {{decidedBy?: string}} [scope] When given, only that wallet's own
 *        decisions. Without it, everything — which only the owner may see.
 */
export function listAdminActions(limit = 50, { decidedBy } = {}) {
  const rows = Math.min(Math.max(Number(limit) || 50, 1), 500);
  if (decidedBy) {
    return db
      .prepare("SELECT * FROM admin_actions WHERE decided_by = ? ORDER BY created_at DESC LIMIT ?")
      .all(decidedBy.toLowerCase(), rows);
  }
  return db.prepare("SELECT * FROM admin_actions ORDER BY created_at DESC LIMIT ?").all(rows);
}
