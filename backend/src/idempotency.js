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

const store = new Map(); // `${userId}:${key}` -> { status: "pending" | "done", result, expiresAt }
const TTL_MS = 15 * 60 * 1000;

function evictExpired() {
  const now = Date.now();
  for (const [k, entry] of store) {
    if (entry.expiresAt < now) store.delete(k);
  }
}

export class IdempotencyPendingError extends Error {
  constructor() {
    super("A previous attempt at this same action is still processing — please wait a moment.");
    this.name = "IdempotencyPendingError";
  }
}

/**
 * Runs `fn` at most once per (userId, idempotencyKey). No key means the
 * caller didn't opt in — `fn` just runs normally, no memoization.
 */
export async function withIdempotency(userId, idempotencyKey, fn) {
  if (!idempotencyKey) return fn();

  evictExpired();
  const storeKey = `${userId}:${idempotencyKey}`;
  const existing = store.get(storeKey);
  if (existing) {
    if (existing.status === "pending") throw new IdempotencyPendingError();
    return existing.result;
  }

  store.set(storeKey, { status: "pending", expiresAt: Date.now() + TTL_MS });
  try {
    const result = await fn();
    store.set(storeKey, { status: "done", result, expiresAt: Date.now() + TTL_MS });
    return result;
  } catch (err) {
    // Nothing succeeded on-chain, so free the slot — a genuine retry (e.g.
    // after the user fixes a validation error) shouldn't be stuck forever.
    store.delete(storeKey);
    throw err;
  }
}
