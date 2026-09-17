/**
 * Navbar.jsx — Sticky top navigation bar
 *
 * Always has a way back to "what is this" (/about) and, once signed in, a way
 * back to your own dashboard and profile — there is no dead end anywhere in
 * the app that only "Sign Out" can escape from.
 */

import React, { useState, useEffect } from "react";
import { Link2, Sun, Moon, BarChart3, LayoutDashboard, User, LogOut, Info, LogIn, UserPlus } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { Link, usePath } from "../utils/navigation.jsx";

const THEME_KEY = "chainproof_theme";

/** Whatever's currently in effect — an explicit saved choice, or the OS preference. */
function currentTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function Navbar() {
  const { status, user, logout } = useAuth();
  const path = usePath();
  const signedIn = status === "authenticated" && user;
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
        <Link to="/" className="navbar-brand" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Link2 size={20} aria-hidden="true" /> ChainProof
        </Link>
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
        {/* One link per destination, and nothing repeated from the page below.
            On a phone the labels hide and the icons remain; each keeps its
            name for screen readers and as a tooltip. */}
        <Link
          to="/results"
          className={`btn btn-ghost btn-sm${path === "/results" || path === "/public" ? " nav-current" : ""}`}
          aria-label="Placement results"
          title="Placement results"
        >
          <BarChart3 size={14} /> <span className="nav-label">Placement results</span>
        </Link>

        {!signedIn && (
          <>
            {path !== "/login" && (
              <Link to="/login" className="btn btn-ghost btn-sm" aria-label="Sign in" title="Sign in">
                <LogIn size={14} /> <span className="nav-label">Sign in</span>
              </Link>
            )}
            {path !== "/signup" && (
              <Link to="/signup" className="btn btn-primary btn-sm" aria-label="Create account" title="Create account">
                <UserPlus size={14} /> <span className="nav-label">Create account</span>
              </Link>
            )}
          </>
        )}

        {signedIn && (
          <>
            {/* Signed-out visitors read the explanation on the home page; once
                signed in, home is the dashboard, so it needs its own link. */}
            <Link
              to="/about"
              className={`btn btn-ghost btn-sm${path === "/about" ? " nav-current" : ""}`}
              aria-label="How it works"
              title="How it works"
            >
              <Info size={14} /> <span className="nav-label">How it works</span>
            </Link>
            <Link
              to="/"
              className={`btn btn-ghost btn-sm${path === "/" ? " nav-current" : ""}`}
              aria-label="Dashboard"
              title="Dashboard"
            >
              <LayoutDashboard size={14} /> <span className="nav-label">Dashboard</span>
            </Link>
            <Link
              to="/profile"
              className={`btn btn-ghost btn-sm${path === "/profile" ? " nav-current" : ""}`}
              aria-label="Account"
              title={`Account · ${user.email}`}
            >
              <User size={14} /> <span className="nav-label">Account</span>
            </Link>
            <button
              id="navbar-logout-btn"
              className="btn btn-ghost btn-sm"
              onClick={logout}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={14} /> <span className="nav-label">Sign out</span>
            </button>
          </>
        )}
      </div>
    </nav>
  );
}
