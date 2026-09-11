/**
 * limits.js — The byte-length bounds enforced on-chain, mirrored here.
 *
 * These match the `MAX_*` constants in contracts/ActorRegistry.sol,
 * contracts/CredentialIssuer.sol, and contracts/PlacementTracker.sol. The
 * contracts are the real enforcement (anyone can call them directly, skipping
 * this backend entirely) — these exist so a user gets a clear, specific
 * message instead of a raw revert bubbling up from a failed transaction.
 *
 * Measured in UTF-8 bytes, exactly like Solidity's `bytes(s).length`, not
 * JavaScript's `.length`. Those disagree for any non-ASCII text: a name in
 * Devanagari or Tamil runs ~3 bytes per character, so a 40-character name is
 * 120 bytes. Using `.length` here would let such a name pass this layer and
 * then revert on-chain — the exact confusing failure this file prevents.
 */

export const MAX_NAME_BYTES = 100;
export const MAX_METADATA_BYTES = 200;
export const MAX_COMPANY_NAME_BYTES = 150;
export const MAX_IPFS_HASH_BYTES = 200;

export function byteLength(value) {
  return Buffer.byteLength(String(value ?? ""), "utf8");
}
