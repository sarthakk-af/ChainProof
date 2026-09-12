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
 */

import crypto from "node:crypto";

const store = new Map(); // `${userId}:${key}` -> { status, result, fingerprint, expiresAt }
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
  const now = Date.now();
  for (const [k, entry] of store) {
    if (entry.expiresAt < now) store.delete(k);
  }
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
 * Runs `fn` at most once per (userId, idempotencyKey, fingerprint). No key
 * means the caller didn't opt in — `fn` just runs normally, no memoization.
 * Reusing a key with a different fingerprint raises
 * IdempotencyKeyConflictError instead of replaying the earlier result.
 */
export async function withIdempotency(userId, idempotencyKey, fingerprint, fn) {
  if (!idempotencyKey) return fn();

  evictExpired();
  const storeKey = `${userId}:${idempotencyKey}`;
  const existing = store.get(storeKey);
  if (existing) {
    // Same key, different request — a client bug, not a retry. Say so rather
    // than handing back an unrelated receipt.
    if (existing.fingerprint !== fingerprint) throw new IdempotencyKeyConflictError();
    if (existing.status === "pending") throw new IdempotencyPendingError();
    return existing.result;
  }

  store.set(storeKey, { status: "pending", fingerprint, expiresAt: Date.now() + TTL_MS });
  try {
    const result = await fn();
    store.set(storeKey, { status: "done", result, fingerprint, expiresAt: Date.now() + TTL_MS });
    return result;
  } catch (err) {
    // Nothing succeeded on-chain, so free the slot — a genuine retry (e.g.
    // after the user fixes a validation error) shouldn't be stuck forever.
    store.delete(storeKey);
    throw err;
  }
}
