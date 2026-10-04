import { db } from "./connection.js";

/**
 * chainActivity.js — every mirrored chain event, with the transaction behind it.
 *
 * Written by the indexer alongside the mirror tables (see the chain_activity
 * table in connection.js for why it is a separate log). Read for the public
 * "recent activity" feed, and for linking a record to its transaction.
 */

/**
 * Logs one event. A second copy of the same event — the indexer reads
 * overlapping blocks, and a route may mirror its own write before the indexer
 * reaches it — is the same (transaction, position) and is ignored.
 */
export function addChainActivity({
  txHash,
  logIndex,
  blockNumber,
  blockTime,
  contract,
  event,
  subject,
  driveId,
  details,
}) {
  db.prepare(
    `INSERT INTO chain_activity
       (tx_hash, log_index, block_number, block_time, contract, event, subject, drive_id, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT DO NOTHING`
  ).run(
    txHash.toLowerCase(),
    logIndex,
    blockNumber,
    blockTime ?? null,
    contract,
    event,
    subject ? subject.toLowerCase() : null,
    driveId ?? null,
    details ? JSON.stringify(details) : null
  );
}

/** The most recent events, newest first, with `details` parsed back. */
export function listRecentChainActivity(limit) {
  return db
    .prepare(
      `SELECT * FROM chain_activity
        ORDER BY block_number DESC, log_index DESC
        LIMIT ?`
    )
    .all(limit)
    .map((row) => ({ ...row, details: row.details ? JSON.parse(row.details) : {} }));
}

/**
 * The transaction that carried a mirrored record, or null when it isn't in the
 * log. Narrowed by whichever of the event's subject, drive, block and
 * preparation-event id the caller knows; the most recent match wins.
 * @dev One wallet's transactions are sent one at a time and each waits for its
 *      block, so (event, subject, block) names a single event in practice.
 */
export function findChainTx({ event, subject, driveId, blockNumber, preparationId }) {
  const clauses = ["event = ?"];
  const params = [event];
  if (subject) {
    clauses.push("subject = ?");
    params.push(subject.toLowerCase());
  }
  if (driveId !== undefined && driveId !== null) {
    clauses.push("drive_id = ?");
    params.push(driveId);
  }
  if (blockNumber !== undefined && blockNumber !== null) {
    clauses.push("block_number = ?");
    params.push(blockNumber);
  }
  if (preparationId !== undefined && preparationId !== null) {
    clauses.push("json_extract(details, '$.eventId') = ?");
    params.push(preparationId);
  }
  const row = db
    .prepare(
      `SELECT tx_hash FROM chain_activity WHERE ${clauses.join(" AND ")}
        ORDER BY block_number DESC, log_index DESC LIMIT 1`
    )
    .get(...params);
  return row?.tx_hash ?? null;
}

export function isActivityHistoryDone() {
  return db.prepare("SELECT activity_history_done FROM indexer_state WHERE id = 1").get()
    .activity_history_done === 1;
}

export function setActivityHistoryDone() {
  db.prepare("UPDATE indexer_state SET activity_history_done = 1 WHERE id = 1").run();
}
