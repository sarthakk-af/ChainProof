/**
 * chain.js — links from a record to its transaction on the public blockchain.
 *
 * The server names the network's block explorer (Polygonscan, on Amoy) at
 * /public/blockchain. It's asked once per page load and remembered; a local
 * test chain has no explorer, and then there is nothing to link to.
 */

import { useEffect, useState } from "react";
import { api } from "./api.js";

let explorerPromise = null;
let explorer;

/** The explorer's base URL, or null when there is none. Fetched once. */
export function loadExplorer() {
  if (!explorerPromise) {
    explorerPromise = api
      .get("/public/blockchain")
      .then((d) => d.network?.explorer ?? null)
      .catch(() => {
        // Try again on the next call rather than remembering a failure.
        explorerPromise = null;
        return null;
      })
      .then((url) => {
        explorer = url;
        return url;
      });
  }
  return explorerPromise;
}

/** A transaction's page on the explorer, or null. */
export function txUrl(base, hash) {
  return base && hash ? `${base}/tx/${hash}` : null;
}

/** The explorer's base URL once known; undefined while loading, null if none. */
export function useExplorer() {
  const [url, setUrl] = useState(explorer);
  useEffect(() => {
    if (url !== undefined) return undefined;
    let cancelled = false;
    loadExplorer().then((u) => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, [url]);
  return url;
}
