/**
 * txQueue.js — Explicit per-wallet nonce management.
 *
 * Each custodial wallet is a fresh `ethers.Wallet` instance per request (see
 * wallets.js), so there's no in-memory signer that remembers "I already sent
 * a transaction from this address." Left to its defaults, ethers asks the
 * provider for the pending nonce on every send — which turned out to return
 * a stale value against a local Hardhat node when a second transaction for
 * the same address followed shortly after the first (even sequentially,
 * request-after-request), producing "nonce has already been used" errors.
 *
 * The fix: track the next nonce per address ourselves, seeded once from the
 * chain and incremented locally after each attempt. `withWalletLock` also
 * serializes attempts for the same address, so two truly concurrent requests
 * (e.g. two browser tabs) can't both reserve the same nonce.
 */

import { provider } from "./chain.js";

const queues = new Map(); // lowercase address -> tail of the pending chain
const nonces = new Map(); // lowercase address -> next nonce to use

async function reserveNonce(address) {
  const key = address.toLowerCase();
  if (!nonces.has(key)) {
    nonces.set(key, await provider.getTransactionCount(address, "latest"));
  }
  const nonce = nonces.get(key);
  nonces.set(key, nonce + 1);
  return nonce;
}

function forgetNonce(address) {
  nonces.delete(address.toLowerCase());
}

/**
 * Whether an error means the cached nonce was stale rather than that the
 * transaction itself was wrong.
 *
 * The cache is per process, so it goes stale whenever something else sends from
 * the same wallet — the seed script funding accounts from the treasury while the
 * backend runs is the everyday case. Before this was recognised, the first
 * signup after seeding failed with "Could not create account" and only the
 * second attempt worked.
 */
function isStaleNonceError(err) {
  const text = `${err?.code ?? ""} ${err?.shortMessage ?? ""} ${err?.message ?? ""}`;
  return /NONCE_EXPIRED|nonce has already been used|nonce too low/i.test(text);
}

/**
 * Runs `fn(nonce)` for one address at a time. `fn` must use the given nonce
 * for its transaction (pass `{ nonce }` as the contract call's overrides).
 * If `fn` throws, the cached nonce is discarded so the next attempt re-derives
 * the true value from the chain instead of staying permanently out of sync.
 *
 * A stale-nonce failure is retried once, with the nonce re-read from the chain.
 * Safe to retry because a rejected nonce means the transaction was never
 * accepted, so nothing is sent twice.
 */
export function withWalletLock(address, fn) {
  const key = address.toLowerCase();
  const previous = queues.get(key) || Promise.resolve();

  const run = previous.catch(() => {}).then(async () => {
    for (let attempt = 1; ; attempt++) {
      const nonce = await reserveNonce(address);
      try {
        return await fn(nonce);
      } catch (err) {
        forgetNonce(address);
        if (attempt === 1 && isStaleNonceError(err)) continue;
        throw err;
      }
    }
  });

  queues.set(key, run.catch(() => {}));
  return run;
}
