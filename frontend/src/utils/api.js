/**
 * api.js — Thin fetch wrapper for the ChainProof backend.
 *
 * Every user-facing action now goes through the backend (see backend/src/app.js)
 * instead of talking to the blockchain directly from the browser — the backend
 * holds each user's custodial wallet and signs on their behalf (see AuthContext.jsx).
 */

const BASE_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";

let authToken = null;

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
  post: (path, body) => request(path, { method: "POST", body }),
  patch: (path, body) => request(path, { method: "PATCH", body }),
  put: (path, body) => request(path, { method: "PUT", body }),
  del: (path) => request(path, { method: "DELETE" }),
};
