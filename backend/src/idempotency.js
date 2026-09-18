/**
 * idempotency.js — Prevents a lost-response retry from becoming a duplicate
 * on-chain write.
 *
 * The risk this closes: a write succeeds on-chain (tx.wait() resolves), but
 * the HTTP response never reaches the client (crash, network drop, timeout).
 * The client sees a failure and retries with what looks like a fresh
 * request — without this, that retry would submit a second, genuinely
 * duplicate transaction, since the contracts have no notion of "this same
 * logical action already happened."
 *
 * The client generates a stable key for one logical attempt (kept across its
 * own retries, discarded once the user changes the underlying inputs — see
 * frontend's per-form idempotency key handling) and sends it along. This
 * store remembers the outcome per (user, key) long enough to answer a retry
 * without touching the chain again.
 *
 * Two things were wrong with the first version, and both defeated its purpose:
 *
 * 1. **It freed the slot whenever the work threw.** `tx.wait()` throws on a
 *    dropped connection or a replaced transaction — *after* the transaction is
 *    in the mempool and possibly mined. Freeing the slot let the retry send a
 *    second one. A send that may have landed now leaves the key unresolved:
 *    the retry is refused and told to check, which is the honest answer, and
 *    the block clears itself after the TTL.
 * 2. **It lived in a Map.** A restart discarded every key — and a crash
 *    between the write and the response is exactly the scenario the module
 *    exists for. The records are now rows, so they survive it.
 */

import crypto from "node:crypto";
import { db } from "./db/connection.js";

const TTL_MS = 15 * 60 * 1000;

/**
 * Stable fingerprint of the request this key stands for.
 *
 * A key on its own says "this is a retry"; it doesn't say a retry *of what*.
 * Without binding the two, a client that reuses a key with different inputs
 * gets the earlier call's receipt back and a 201 — told its request
 * succeeded while nothing at all was written. A silent false success is the
 * worst possible failure here, because the caller has no reason to check.
 */
export function fingerprintPayload(parts) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex");
}

function evictExpired() {
  db.prepare("DELETE FROM idempotency_keys WHERE expires_at < ?").run(Date.now());
}

export class IdempotencyKeyConflictError extends Error {
  constructor() {
    super(
      "That idempotency key was already used for a different request. " +
        "Use a fresh key when the details change."
    );
    this.name = "IdempotencyKeyConflictError";
  }
}

export class IdempotencyPendingError extends Error {
  constructor() {
    super("A previous attempt at this same action is still processing — please wait a moment.");
    this.name = "IdempotencyPendingError";
  }
}

/**
 * Raised when an earlier attempt was broadcast but never seen to confirm.
 *
 * Deliberately not retryable: the transaction may well be on the chain. Saying
 * "have a look before sending another" is the only answer that can't create a
 * second permanent record.
 */
export class IdempotencyUnresolvedError extends Error {
  constructor() {
    super(
      "An earlier attempt at this action was sent to the blockchain and we never saw it " +
        "confirm. Reload and check whether it went through before trying again."
    );
    this.name = "IdempotencyUnresolvedError";
  }
}

/**
 * Runs `fn` at most once per (userId, idempotencyKey, fingerprint). No key
 * means the caller didn't opt in — `fn` just runs normally, no memoization.
 * Reusing a key with a different fingerprint raises
 * IdempotencyKeyConflictError instead of replaying the earlier result.
 *
 * `fn` is handed `{ markBroadcast }` and must call it once the transaction has
 * been accepted by the node — everything after that point is unsafe to repeat.
 * The returned value is stored as JSON, so it must be the response payload
 * rather than an object with behaviour (a receipt, say).
 */
export async function withIdempotency(userId, idempotencyKey, fingerprint, fn) {
  const noop = { markBroadcast: () => {} };
  if (!idempotencyKey) return fn(noop);

  evictExpired();
  const storeKey = `${userId}:${idempotencyKey}`;
  const existing = db
    .prepare("SELECT * FROM idempotency_keys WHERE store_key = ?")
    .get(storeKey);

  if (existing) {
    // Same key, different request — a client bug, not a retry. Say so rather
    // than handing back an unrelated receipt.
    if (existing.fingerprint !== fingerprint) throw new IdempotencyKeyConflictError();
    if (existing.status === "done") return JSON.parse(existing.result);
    if (existing.status === "unresolved") throw new IdempotencyUnresolvedError();
    throw new IdempotencyPendingError();
  }

  try {
    db.prepare(
      `INSERT INTO idempotency_keys (store_key, fingerprint, status, broadcast, expires_at)
       VALUES (?, ?, 'pending', 0, ?)`
    ).run(storeKey, fingerprint, Date.now() + TTL_MS);
  } catch {
    // Lost the race to a concurrent request with the same key — that one owns
    // the slot, and this one is a retry by definition.
    throw new IdempotencyPendingError();
  }

  let broadcast = false;
  const markBroadcast = () => {
    broadcast = true;
    db.prepare("UPDATE idempotency_keys SET broadcast = 1 WHERE store_key = ?").run(storeKey);
  };

  try {
    const result = await fn({ markBroadcast });
    db.prepare(
      "UPDATE idempotency_keys SET status = 'done', result = ?, expires_at = ? WHERE store_key = ?"
    ).run(JSON.stringify(result ?? null), Date.now() + TTL_MS, storeKey);
    return result;
  } catch (err) {
    if (broadcast) {
      db.prepare(
        "UPDATE idempotency_keys SET status = 'unresolved', expires_at = ? WHERE store_key = ?"
      ).run(Date.now() + TTL_MS, storeKey);
    } else {
      // Nothing was sent, so the key is free again — a genuine retry after a
      // validation error or an unreachable node shouldn't be stuck.
      db.prepare("DELETE FROM idempotency_keys WHERE store_key = ?").run(storeKey);
    }
    throw err;
  }
}
