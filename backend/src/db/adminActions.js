import { db } from "./connection.js";

/** Records one verification decision — see connection.js's admin_actions table comment for why this exists. */
export function logAdminAction({ actorAddress, actorName, action, reason, txHash, adminUsername }) {
  db.prepare(
    `INSERT INTO admin_actions (actor_address, actor_name, action, reason, tx_hash, admin_username, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(actorAddress, actorName || null, action, reason || null, txHash || null, adminUsername || null, Date.now());
}

export function listAdminActions(limit = 50) {
  return db
    .prepare("SELECT * FROM admin_actions ORDER BY created_at DESC LIMIT ?")
    .all(limit);
}
