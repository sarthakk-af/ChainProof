/**
 * navigation.jsx — moving between pages without a full reload.
 *
 * The app reads the page from the URL path. Changing pages used to mean either a
 * full reload or swapping content without touching the URL at all — which is why
 * "Sign in" had no address of its own and the browser's Back button did nothing
 * useful. These helpers change the URL properly and let the app re-render, so
 * every page can be linked to, refreshed, and backed out of.
 */

import React, { useEffect, useState } from "react";

const EVENT = "chainproof:navigate";

/** Goes to a path inside the app, adding it to the browser's history. */
export function navigate(path, { replace = false } = {}) {
  if (path === window.location.pathname + window.location.search) return;
  if (replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  window.dispatchEvent(new Event(EVENT));
  window.scrollTo(0, 0);
}

/** The current path, kept up to date across in-app navigation and Back/Forward. */
export function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener("popstate", update);
    window.addEventListener(EVENT, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(EVENT, update);
    };
  }, []);
  return path;
}

/**
 * A link that stays inside the app.
 *
 * Still a real <a href>, so opening it in a new tab or copying the address
 * works as people expect; only a plain left-click is handled in place.
 */
export function Link({ to, onClick, children, ...rest }) {
  const handleClick = (e) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}
