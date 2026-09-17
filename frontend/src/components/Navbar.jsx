/**
 * Navbar.jsx — Sticky top navigation bar
 *
 * Always has a way back to "what is this" (/about) and, once signed in, a way
 * back to your own dashboard and profile — there is no dead end anywhere in
 * the app that only "Sign Out" can escape from.
 */

import React, { useState, useEffect } from "react";
import { Link2, Sun, Moon, ArrowLeft, BarChart3, LayoutDashboard, User, LogOut, Info } from "lucide-react";
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
          <Link2 size={20} aria-hidden="true" /> ChainProof
        </a>
        <span
          className="badge badge-warning nav-testnet"
          style={{ fontSize: "0.68rem" }}
          title="Running on a private practice blockchain for development/demo purposes — not a public or production network"
        >
          <span aria-hidden="true">●</span> <span className="nav-label">Test Network</span>
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
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        {/* On a phone the labels hide and the icons remain; each link keeps its
            name for screen readers and as a tooltip, so nothing becomes a
            mystery button. */}
        {path !== "/about" && (
          <a href="/about" className="btn btn-ghost btn-sm" aria-label="How it works" title="How it works">
            <Info size={14} /> <span className="nav-label">How It Works</span>
          </a>
        )}
        {path === "/public" ? (
          <a href="/" className="btn btn-ghost btn-sm" aria-label="Back to app" title="Back to app">
            <ArrowLeft size={14} /> <span className="nav-label">Back to App</span>
          </a>
        ) : (
          <a href="/public" className="btn btn-ghost btn-sm" aria-label="Public dashboard" title="Public dashboard">
            <BarChart3 size={14} /> <span className="nav-label">Public Dashboard</span>
          </a>
        )}
        {status === "authenticated" && user && (
          <>
            {path !== "/" && (
              <a href="/" className="btn btn-ghost btn-sm" aria-label="Dashboard" title="Dashboard">
                <LayoutDashboard size={14} /> <span className="nav-label">Dashboard</span>
              </a>
            )}
            {path !== "/profile" && (
              <a href="/profile" className="btn btn-ghost btn-sm" aria-label="Profile" title="Profile">
                <User size={14} /> <span className="nav-label">Profile</span>
              </a>
            )}
            {actor && (
              <span className={`badge nav-hide-sm ${ROLE_BADGE_CLASS[actor.role] || "badge-none"}`}>
                {actor.role}
                {actor.status !== "Active" ? ` · ${actor.status}` : ""}
              </span>
            )}
            <span className="mono-addr nav-hide-sm" title={`${user.email} · ${user.address}`}>
              {shortAddr(user.address)}
            </span>
            <button
              id="navbar-logout-btn"
              className="btn btn-ghost btn-sm"
              onClick={logout}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={14} /> <span className="nav-label">Sign Out</span>
            </button>
          </>
        )}
      </div>
    </nav>
  );
}
