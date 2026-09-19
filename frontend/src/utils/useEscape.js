/**
 * Escape closes the thing that is open.
 *
 * Every form here already had a Cancel button, but the keyboard had no way to
 * reach the same decision — and Escape is the one shortcut people try without
 * being told about it.
 */
import { useEffect } from "react";

export function useEscape(onEscape, active = true) {
  useEffect(() => {
    if (!active || typeof onEscape !== "function") return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onEscape();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onEscape, active]);
}
