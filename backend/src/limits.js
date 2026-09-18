/**
 * limits.js — The byte-length bounds enforced on-chain, mirrored here.
 *
 * These match the `MAX_*` constants in contracts/ActorRegistry.sol and
 * contracts/PlacementDrive.sol. The
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
export const MAX_IPFS_HASH_BYTES = 200;

/**
 * The one email pattern the whole backend uses: signup, the roster, and the
 * classmate lookup. Deliberately loose — the only real proof that an address
 * belongs to someone is the code sent to it.
 */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lower-cased and trimmed, the form every stored email takes. */
export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function byteLength(value) {
  return Buffer.byteLength(String(value ?? ""), "utf8");
}
