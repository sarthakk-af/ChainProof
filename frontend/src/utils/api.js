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
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: "POST", body }),
};
