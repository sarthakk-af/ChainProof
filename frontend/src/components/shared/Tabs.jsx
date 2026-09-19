/**
 * Tabs.jsx — the one tab bar every page uses.
 *
 * Every dashboard used to draw its own row of loose buttons, spread across the
 * full width, while the public page had a joined tab bar — so the same idea
 * looked different on every screen. This is the single version.
 *
 * The selected tab is kept in the address (?tab=…), so refreshing a page, or
 * pressing Back, returns to the tab you were on instead of the first one.
 */

import React, { useCallback, useEffect, useState } from "react";

function readTab(ids, fallback) {
  const value = new URLSearchParams(window.location.search).get("tab");
  return ids.includes(value) ? value : fallback;
}

/**
 * The selected tab, backed by the URL.
 * @param {string[]} ids      Every valid tab id.
 * @param {string}   fallback The tab to show when the URL names none.
 */
export function useUrlTab(ids, fallback) {
  const [tab, setTabState] = useState(() => readTab(ids, fallback));
  const key = ids.join(",");

  useEffect(() => {
    const sync = () => setTabState(readTab(key.split(","), fallback));
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [key, fallback]);

  const setTab = useCallback((next) => {
    const params = new URLSearchParams(window.location.search);
    params.set("tab", next);
    window.history.pushState(null, "", `${window.location.pathname}?${params.toString()}`);
    setTabState(next);
  }, []);

  return [tab, setTab];
}

/**
 * @param {Object} props
 * @param {Array<{id: string, label: string, icon?: Function, count?: number}>} props.tabs
 * @param {string} props.value
 * @param {(id: string) => void} props.onChange
 * @param {string} props.label  Accessible name for the tab bar.
 */
export default function Tabs({ tabs, value, onChange, label }) {
  /**
   * Arrow keys move between tabs, as they do in every other tabbed interface.
   * Without this a keyboard user tabs through all seven to reach the last one,
   * and the role="tablist" we already claimed was a promise we did not keep.
   */
  const onKeyDown = (e) => {
    const order = tabs.map((t) => t.id);
    const at = order.indexOf(value);
    let next = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = order[(at + 1) % order.length];
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = order[(at - 1 + order.length) % order.length];
    if (e.key === "Home") next = order[0];
    if (e.key === "End") next = order[order.length - 1];
    if (!next) return;
    e.preventDefault();
    onChange(next);
    // Follow the selection, so what is focused and what is shown agree.
    document.getElementById(`tab-${next}`)?.focus();
  };

  return (
    <div className="tabs-row">
      <div className="seg tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {tabs.map(({ id, label: text, icon: Icon, count }) => (
          <button
            key={id}
            id={`tab-${id}`}
            type="button"
            role="tab"
            aria-selected={id === value}
            aria-controls={`panel-${id}`}
            // Only the selected tab is in the tab order; the arrows reach the
            // rest. That is what a tablist is supposed to do.
            tabIndex={id === value ? 0 : -1}
            onClick={() => onChange(id)}
          >
            {Icon && <Icon size={14} aria-hidden="true" />}
            <span>{text}</span>
            {count > 0 && <span className="count">{count}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
