/**
 * Navbar.jsx — Sticky top navigation bar
 *
 * Always has a way back to "what is this" (/about) and, once signed in, a way
 * back to your own dashboard and profile — there is no dead end anywhere in
 * the app that only "Sign Out" can escape from.
 */

import React, { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { shortAddr } from "../utils/format.js";

const ROLE_BADGE_CLASS = {
  Student: "badge-student",
  College: "badge-college",
  Company: "badge-company",
};

const THEME_KEY = "chainproof_theme";

/** Whatever's currently in effect — an explicit saved choice, or the OS preference. */
function currentTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function Navbar() {
  const { status, user, actor, logout } = useAuth();
  const path = window.location.pathname;
  const [theme, setTheme] = useState(currentTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  return (
    <nav className="navbar animate-fade-in">
      {/* Brand — always links back home */}
      <div className="flex items-center gap-12">
        <a href="/" className="navbar-brand" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span aria-hidden="true">⛓</span> ChainProof
        </a>
        <span
          className="badge badge-warning"
          style={{ fontSize: "0.68rem" }}
          title="Running on a private practice blockchain for development/demo purposes — not a public or production network"
        >
          <span aria-hidden="true">●</span> Test Network
        </span>
      </div>

      {/* Right side */}
      <div className="navbar-meta">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          <span aria-hidden="true">{theme === "dark" ? "☀️" : "🌙"}</span>
        </button>
        {path !== "/about" && (
          <a href="/about" className="btn btn-ghost btn-sm">How It Works</a>
        )}
        {path === "/public" ? (
          <a href="/" className="btn btn-ghost btn-sm">← Back to App</a>
        ) : (
          <a href="/public" className="btn btn-ghost btn-sm"><span aria-hidden="true">📊</span> Public Dashboard</a>
        )}
        {status === "authenticated" && user && (
          <>
            {path !== "/" && (
              <a href="/" className="btn btn-ghost btn-sm">Dashboard</a>
            )}
            {path !== "/profile" && (
              <a href="/profile" className="btn btn-ghost btn-sm">Profile</a>
            )}
            {actor && (
              <span className={`badge ${ROLE_BADGE_CLASS[actor.role] || "badge-none"}`}>
                {actor.role}
                {actor.status !== "Active" ? ` · ${actor.status}` : ""}
              </span>
            )}
            <span className="mono-addr" title={`${user.email} · ${user.address}`}>
              {shortAddr(user.address)}
            </span>
            <button id="navbar-logout-btn" className="btn btn-ghost btn-sm" onClick={logout}>
              Sign Out
            </button>
          </>
        )}
      </div>
    </nav>
  );
}
