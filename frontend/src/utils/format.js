/** Shared formatting helpers used across every dashboard so the same data always looks the same. */

export function shortAddr(addr, { head = 6, tail = 4 } = {}) {
  if (!addr) return "";
  return addr.slice(0, head) + "…" + addr.slice(-tail);
}

export function formatTimestamp(ts) {
  return new Date(Number(ts) * 1000).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatDate(ts) {
  return new Date(Number(ts) * 1000).toLocaleDateString("en-IN", {
    dateStyle: "medium",
  });
}
