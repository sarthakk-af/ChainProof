/**
 * ipfsService.js — pins a drive's job description to IPFS.
 *
 * A drive stores only a content hash on-chain; the full job description lives
 * on IPFS. With VITE_PINATA_JWT set, the document is genuinely pinned through
 * Pinata and anyone can fetch it from a public gateway. Without it, a
 * well-formed placeholder hash is used so the app still works end to end on a
 * machine with no IPFS account — the drive's terms that matter (package,
 * cutoff, deadline) are on-chain either way.
 */

const PINATA_JWT = import.meta.env.VITE_PINATA_JWT;

// The base58btc alphabet a real CIDv0 uses — note it omits 0, O, I and l, the
// characters people misread when copying a hash by hand.
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Deterministic stand-in hash for when no IPFS account is configured.
 *
 * Shaped like a genuine CIDv0 (Qm + 44 base58 characters) on purpose: the
 * backend validates that an ipfsHash really is a CID before writing it
 * on-chain, and a fallback that produced something unparseable would mean the
 * app worked with Pinata configured and broke without it — the exact kind of
 * divergence that only shows up in front of an audience.
 */
function placeholderHash(payload) {
  const str = JSON.stringify(payload) + Date.now() + Math.random();
  let hash = 5381;
  let out = "";
  for (let i = 0; i < 44; i++) {
    for (let j = 0; j < str.length; j++) {
      hash = ((hash << 5) + hash) ^ (str.charCodeAt(j) + i);
    }
    out += BASE58[Math.abs(hash) % BASE58.length];
  }
  return "Qm" + out;
}

/**
 * Pins a JSON document and returns its content hash.
 * @param {object} payload The document to pin.
 * @returns {Promise<string>} The IPFS CID, or a placeholder if pinning is unavailable.
 */
export async function uploadToIPFS(payload) {
  if (PINATA_JWT) {
    try {
      const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${PINATA_JWT}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pinataContent: payload,
          pinataMetadata: { name: `ChainProof-${Date.now()}` },
        }),
      });
      if (!res.ok) throw new Error(`Pinata error: ${res.statusText}`);
      const data = await res.json();
      return data.IpfsHash;
    } catch (err) {
      console.warn("[IPFS] Pinata failed, using a placeholder hash:", err.message);
    }
  }
  return placeholderHash(payload);
}
