import { byteLength, MAX_IPFS_HASH_BYTES } from "./limits.js";

/**
 * Validates that a value actually looks like an IPFS content identifier.
 *
 * The old check here was "non-empty and short enough," which meant any string
 * at all could be written into a credential — and that value goes on-chain
 * permanently. A record pointing at a hash that resolves nowhere is worse than
 * no record: it looks verifiable and isn't, which is the one thing this
 * project cannot afford to get wrong.
 *
 * Two forms are accepted:
 *   CIDv0 — "Qm" followed by 44 base58btc characters (the classic 46-char
 *           hash Pinata returns for a pinned JSON document).
 *   CIDv1 — "b" followed by base32 (lowercase letters and digits 2-7).
 *
 * Note the base58 alphabet deliberately omits 0, O, I and l, since those are
 * the characters people misread when copying a hash by hand.
 */
const CID_V0 = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
const CID_V1 = /^b[a-z2-7]{50,}$/;

export function validateIpfsHash(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return { error: "An IPFS hash is required." };
  }
  // Checked before the format test so an over-long paste gets the specific
  // complaint rather than a confusing "not a valid hash".
  if (byteLength(trimmed) > MAX_IPFS_HASH_BYTES) {
    return { error: `ipfsHash must be ${MAX_IPFS_HASH_BYTES} bytes or fewer` };
  }
  if (!CID_V0.test(trimmed) && !CID_V1.test(trimmed)) {
    return {
      error:
        "That doesn't look like an IPFS hash. Expected a CID such as " +
        "Qm… (46 characters) or b… — check that the document upload actually succeeded.",
    };
  }
  return { value: trimmed };
}
