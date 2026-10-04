/**
 * api.js — Thin fetch wrapper for the ChainProof backend.
 *
 * Every user-facing action now goes through the backend (see backend/src/app.js)
 * instead of talking to the blockchain directly from the browser — the backend
 * holds each user's custodial wallet and signs on their behalf (see AuthContext.jsx).
 */

import { toast } from "./toast.js";
import { loadExplorer, txUrl } from "./chain.js";

const BASE_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";

let authToken = null;

/**
 * Requests that write to the blockchain. On the public network each one waits
 * until its block is final — a few seconds — and a button that only spins for
 * that long reads as broken.
 */
const CHAIN_WRITES = [
  /^\/drives$/,
  /^\/drives\/\d+\/(close|cancel|application-count)$/,
  /^\/outcomes\/\d+\/(stage|answer)$/,
  /^\/college\/(events|batches)$/,
  /^\/college\/events\/\d+\/cancel$/,
  /^\/college\/companies\/[^/]+\/(approve|reject)$/,
  /^\/college\/drives\/\d+\/(approve|reject)$/,
  /^\/college\/verifications\/\d+\/approve$/,
  /^\/me\/(register|claim-roll-number)$/,
  /^\/auth\/verify-email$/,
  /^\/admin\/college$/,
  /^\/admin\/accounts\/[^/]+\/(suspend|reinstate)$/,
];

const SLOW_AFTER_MS = 1500;

/**
 * Shows a "still working" toast if `promise` is still pending after a moment,
 * and clears it the moment the request settles. Fast requests never see it.
 */
export function noticeIfSlow(method, path, promise) {
  if (method === "GET") return promise;
  const isChainWrite = CHAIN_WRITES.some((re) => re.test(path.split("?")[0]));
  let toastId = null;
  const timer = setTimeout(() => {
    // What is actually happening, in order — the browser only hears back at
    // the end, so this describes the steps rather than pretending to track them.
    toastId = toast.loading(
      isChainWrite
        ? "Recording this on the blockchain: your account's wallet signs it, the network adds it to a block, and we wait a few seconds until it's final. Please keep this page open."
        : "Still working…"
    );
  }, SLOW_AFTER_MS);
  const done = () => {
    clearTimeout(timer);
    if (toastId !== null) toast.dismiss(toastId);
  };
  promise.then(done, done);
  if (isChainWrite) promise.then(announceTransaction, () => {});
  return promise;
}

/**
 * After a blockchain write, a link to its transaction on the public explorer —
 * the record, seconds old, on a site ChainProof doesn't control. Shown beside
 * the screen's own "done" message rather than replacing it. Nothing when the
 * response names no transaction or the network has no explorer.
 */
function announceTransaction(result) {
  const hash = result?.txHash;
  if (!hash) return;
  loadExplorer().then((base) => {
    const href = txUrl(base, hash);
    // Longer than an ordinary toast: it carries a link someone may want to open.
    if (href) {
      toast.info("Recorded on the blockchain.", {
        link: { href, label: "View transaction" },
        duration: 12000,
      });
    }
  });
}

/** Called by AuthContext whenever the session token changes (login/logout). */
export function setAuthToken(token) {
  authToken = token;
}

async function request(path, { method = "GET", body, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // fetch only throws when no response arrived at all. Its own message is
    // "Failed to fetch", which tells the reader nothing.
    throw new Error("Can't reach the ChainProof server. Check that the backend is running.");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed: ${res.status}`);
    // Some routes (e.g. /auth/login when the account isn't verified yet)
    // carry extra fields on an error response that the caller needs to act
    // on — attach the whole body rather than just the message string.
    Object.assign(err, data);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => noticeIfSlow("POST", path, request(path, { method: "POST", body })),
  patch: (path, body) => noticeIfSlow("PATCH", path, request(path, { method: "PATCH", body })),
  put: (path, body) => noticeIfSlow("PUT", path, request(path, { method: "PUT", body })),
  del: (path) => noticeIfSlow("DELETE", path, request(path, { method: "DELETE" })),
};
