/**
 * websiteCheck.js — Turns the optional "website" field from a bare, unchecked
 * string into something with actual evidence behind it: a real URL shape
 * check at registration time, plus a live reachability probe recorded for
 * the admin queue (see routes/me.js and db/actors.js's setWebsiteReachable).
 *
 * Deliberately stops short of proving *ownership* of the domain (e.g. a
 * verification token the college would place on their site) — that's real,
 * valuable work, but it depends on external DNS/HTTP infrastructure that
 * isn't this project's to guarantee, and failing unpredictably mid-demo is
 * worse than being honest that this is "reachable," not "owned."
 */

const FETCH_TIMEOUT_MS = 5000;

/** Normalizes and validates the URL shape. Returns { value } or { error }. */
export function validateWebsiteFormat(website) {
  if (!website || !website.trim()) return { value: "" };

  let url;
  try {
    url = new URL(website.trim());
  } catch {
    return { error: "Website must be a valid URL, e.g. https://example.edu" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { error: "Website must start with http:// or https://" };
  }
  if (!url.hostname.includes(".")) {
    return { error: "Website must be a valid URL, e.g. https://example.edu" };
  }
  return { value: url.toString() };
}

async function fetchWithTimeout(url, method) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { method, signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Live-probes the URL. Returns true/false, or null if there's nothing to
 * check. Never throws — a network hiccup just means "couldn't confirm,"
 * not a crash in whatever called this.
 */
export async function checkWebsiteReachable(website) {
  if (!website) return null;
  try {
    let res = await fetchWithTimeout(website, "HEAD");
    // A handful of servers reject HEAD outright but are otherwise live —
    // worth a GET retry before calling the site unreachable.
    if (!res.ok) {
      res = await fetchWithTimeout(website, "GET");
    }
    return res.ok;
  } catch {
    return false;
  }
}
