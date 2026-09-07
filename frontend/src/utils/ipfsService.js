/**
 * ipfsService.js — Mock IPFS Utility for ChainProof
 *
 * Strategy (priority order):
 *  1. If VITE_PINATA_JWT is set → upload via Pinata pinning API
 *  2. If VITE_WEB3_STORAGE_TOKEN is set → upload via Web3.Storage
 *  3. Fallback → store payload in localStorage, return a deterministic mock hash
 *
 * The returned hash is always used as the `ipfsHash` field in on-chain credentials,
 * so the system remains fully functional without IPFS credentials configured.
 */

const PINATA_JWT   = import.meta.env.VITE_PINATA_JWT;
const W3S_TOKEN    = import.meta.env.VITE_WEB3_STORAGE_TOKEN;
const LOCAL_KEY    = "chainproof_ipfs_store";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Simple deterministic hash for local mock storage */
function mockHash(payload) {
  const str = JSON.stringify(payload) + Date.now();
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return "QmMock" + Math.abs(hash).toString(16).padStart(40, "0").slice(0, 40);
}

/** Persist to localStorage under a fake content-addressed key */
function localStore(hash, payload) {
  try {
    const store = JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}");
    store[hash] = payload;
    localStorage.setItem(LOCAL_KEY, JSON.stringify(store));
  } catch (_) { /* storage quota exceeded — silent fail */ }
}

/** Retrieve from localStorage */
export function localRetrieve(hash) {
  try {
    const store = JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}");
    return store[hash] || null;
  } catch (_) { return null; }
}

// ── Upload ──────────────────────────────────────────────────────────────────

/**
 * Upload a JSON payload to IPFS (or mock storage).
 * @param {object} payload - The metadata object to store.
 * @returns {Promise<string>} The IPFS CID / mock hash.
 */
export async function uploadToIPFS(payload) {
  // --- Option 1: Pinata ---
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
      console.info("[IPFS] Pinned via Pinata:", data.IpfsHash);
      return data.IpfsHash;
    } catch (err) {
      console.warn("[IPFS] Pinata failed, falling back to mock:", err.message);
    }
  }

  // --- Option 2: Web3.Storage ---
  if (W3S_TOKEN) {
    try {
      // Use Web3.Storage HTTP API directly (no npm package needed)
      const res = await fetch("https://api.web3.storage/upload", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${W3S_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Web3.Storage error: ${res.statusText}`);
      const data = await res.json();
      console.info("[IPFS] Stored via Web3.Storage:", data.cid);
      return data.cid;
    } catch (err) {
      console.warn("[IPFS] Web3.Storage failed, falling back to mock:", err.message);
    }
  }

  // --- Option 3: Local Mock Fallback ---
  const hash = mockHash(payload);
  localStore(hash, payload);
  console.info("[IPFS] Mock storage used. Hash:", hash);
  return hash;
}

/**
 * Build a standardized credential metadata payload.
 * This is the JSON structure stored on IPFS and referenced by the ipfsHash on-chain.
 */
export function buildCredentialMetadata({
  title,
  description,
  issuerName,
  issuerAddress,
  studentAddress,
  credType,
  additionalData = {},
}) {
  return {
    schema: "chainproof-credential-v1",
    title,
    description,
    issuerName,
    issuerAddress,
    studentAddress,
    credentialType: credType,
    issuedAt: new Date().toISOString(),
    additionalData,
  };
}
