/** Shared formatting helpers used across every dashboard so the same data always looks the same. */

export function shortAddr(addr, { head = 6, tail = 4 } = {}) {
  if (!addr) return "";
  return addr.slice(0, head) + "…" + addr.slice(-tail);
}

export function formatDate(ts) {
  return new Date(Number(ts) * 1000).toLocaleDateString("en-IN", {
    dateStyle: "medium",
  });
}

/**
 * An annual package the way it is read in India: 650000 is "₹6.5 LPA".
 * Anything under a lakh is shown in full rather than as a fraction of one.
 */
export function formatLPA(rupees) {
  const n = Number(rupees);
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n < 100000) return `₹${n.toLocaleString("en-IN")}`;
  const lakhs = n / 100000;
  // Two decimals trimmed of trailing zeros, so 12.5 stays 12.5 and 6.75 stays
  // 6.75 — rounding a package on a page about honest figures would be the one
  // place it mattered most.
  const text = lakhs.toFixed(2).replace(/\.?0+$/, "");
  return `₹${text} LPA`;
}
