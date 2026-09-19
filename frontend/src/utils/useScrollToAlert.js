/**
 * Brings a freshly-set error or notice into view.
 *
 * Both appear at the top of the page, so submitting a long form from its last
 * field left nothing visibly happening at all — the answer was two screens
 * above, unread.
 */
import { useEffect } from "react";

export function useScrollToAlert(message) {
  useEffect(() => {
    if (!message) return;
    const alert = document.querySelector('[role="alert"], [role="status"]');
    if (!alert) return;
    const { top } = alert.getBoundingClientRect();
    // Only when it is actually out of sight; scrolling under someone who can
    // already see the message is its own annoyance.
    if (top < 0 || top > window.innerHeight - 80) {
      alert.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [message]);
}
