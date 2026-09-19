/**
 * Loading.jsx — one way of saying "this is on its way".
 *
 * Every screen wrote its own "Loading…", which says nothing: loading what,
 * and is it nearly there? These say what is coming, and they hold the shape of
 * what will replace them so the page doesn't jump when it arrives.
 *
 * `aria-busy` and the polite live region matter more than they look: a spinner
 * nobody can see is not feedback.
 */

import React, { useEffect, useState } from "react";

/**
 * True once the wait has lasted long enough to be worth mentioning.
 *
 * A placeholder that appears and vanishes inside 80ms reads as a flicker, and
 * most of these requests are answered from a database on the same machine.
 */
function useSlowEnough(delay = 180) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);
  return show;
}

/** A line of text for small areas — a panel header, an inline section. */
export function LoadingLine({ label = "Loading" }) {
  const show = useSlowEnough();
  if (!show) return null;

  return (
    <p className="form-hint" role="status" aria-busy="true">
      {label}…
    </p>
  );
}

/**
 * Placeholder rows shaped like the list they stand in for.
 * @param {{rows?: number, label: string}} props
 */
export function LoadingRows({ rows = 3, label }) {
  const show = useSlowEnough();
  if (!show) return null;

  return (
    <div className="row-list" role="status" aria-busy="true" aria-label={`${label}…`}>
      {Array.from({ length: rows }, (_, i) => (
        <div className="row skeleton-row" key={i}>
          <div>
            <span className="skeleton skeleton-title" />
            <span className="skeleton skeleton-meta" />
          </div>
          <span className="skeleton skeleton-pill" />
        </div>
      ))}
      <span className="visually-hidden">{label}…</span>
    </div>
  );
}
