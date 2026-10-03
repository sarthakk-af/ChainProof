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
 *
 * The probe only ever reaches the public internet. It used to fetch whatever
 * URL a company typed, from inside the server — so "http://localhost:4000",
 * a router's admin page or a cloud metadata address were all requests the
 * server would make on a stranger's behalf (server-side request forgery). Now
 * every connection checks the address it is actually about to reach:
 *   - the check runs inside the connection's own DNS lookup, so a hostname
 *     that resolves somewhere private is refused, and one that resolves
 *     differently on a second lookup (DNS rebinding) can't slip past it;
 *   - an IP written directly into the URL is checked the same way;
 *   - redirects are followed by hand, a few at most, each hop checked again;
 *   - the response body is never read.
 */

import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";

const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;

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

/** Every range that is not the public internet: private, loopback, link-local, reserved. */
const NOT_PUBLIC = new net.BlockList();
for (const [prefix, bits] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, including cloud metadata (169.254.169.254)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 3], // multicast and reserved, through 255.255.255.255
]) {
  NOT_PUBLIC.addSubnet(prefix, bits, "ipv4");
}
for (const [prefix, bits] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
  ["2001:db8::", 32], // documentation
]) {
  NOT_PUBLIC.addSubnet(prefix, bits, "ipv6");
}

/** Whether an IP address is on the public internet. */
export function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 0) return false;
  if (family === 6) {
    // An IPv4 address written as IPv6 (::ffff:127.0.0.1) is judged as IPv4.
    const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]);
    return !NOT_PUBLIC.check(address, "ipv6");
  }
  return !NOT_PUBLIC.check(address, "ipv4");
}

class BlockedAddressError extends Error {}

/**
 * A DNS lookup that refuses any answer off the public internet. Passed to the
 * request itself, so the address checked is the address connected to.
 */
function publicOnlyLookup(hostname, options, callback) {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return callback(err);
    const answers = Array.isArray(address) ? address : [{ address, family }];
    if (answers.length === 0 || answers.some((a) => !isPublicAddress(a.address))) {
      return callback(new BlockedAddressError(`${hostname} does not resolve to a public address`));
    }
    return Array.isArray(address) ? callback(null, address) : callback(null, address, family);
  });
}

/** One request, body unread. Resolves { status, location }. */
function requestOnce(url, method) {
  return new Promise((resolve, reject) => {
    // An IP literal never goes through a lookup, so it is checked here.
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(host) && !isPublicAddress(host)) {
      reject(new BlockedAddressError(`${host} is not a public address`));
      return;
    }
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(url, { method, lookup: publicOnlyLookup, timeout: TIMEOUT_MS }, (res) => {
      resolve({ status: res.statusCode, location: res.headers.location });
      res.destroy();
    });
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end();
  });
}

/** Follows redirects by hand, checking every hop. Resolves the final status. */
async function probe(startUrl, method) {
  let url = new URL(startUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const { status, location } = await requestOnce(url, method);
    if (status >= 300 && status < 400 && location) {
      url = new URL(location, url);
      if (url.protocol !== "http:" && url.protocol !== "https:") return 0;
      continue;
    }
    return status;
  }
  return 0; // too many redirects
}

/**
 * Live-probes the URL. Returns true/false, or null if there's nothing to
 * check. Never throws — a network hiccup, or an address that isn't public,
 * just means "couldn't confirm", not a crash in whatever called this.
 */
export async function checkWebsiteReachable(website) {
  if (!website) return null;
  const ok = (status) => status >= 200 && status < 300;
  try {
    // A handful of servers reject HEAD outright but are otherwise live —
    // worth a GET retry before calling the site unreachable.
    if (ok(await probe(website, "HEAD"))) return true;
    return ok(await probe(website, "GET"));
  } catch {
    return false;
  }
}
