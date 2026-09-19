/**
 * Navbar.jsx — Sticky top navigation bar
 *
 * Always has a way back to "what is this" (/about) and, once signed in, a way
 * back to your own dashboard and profile — there is no dead end anywhere in
 * the app that only "Sign Out" can escape from.
 */

import React, { useState, useEffect, useRef } from "react";
import {
  Link2, Sun, Moon, BarChart3, LayoutDashboard, User, LogOut, Info, LogIn, UserPlus, Menu, X,
} from "lucide-react";
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
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  // The bar's height, for anything that sticks just below it (the tab bars).
  // Measured rather than hard-coded because the bar wraps on narrow screens.
  const navRef = useRef(null);
  useEffect(() => {
    const el = navRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty("--nav-h", `${el.offsetHeight}px`);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Going somewhere closes the menu; so does Escape, and so does clicking away
  // from it. A menu that stays open after you have used it is a menu you then
  // have to dismiss.
  useEffect(() => setMenuOpen(false), [path]);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    const onClick = (e) => {
      if (navRef.current && !navRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [menuOpen]);

  /**
   * One description of where you can go, rendered twice: as a row of buttons
   * on a wide screen, and as a labelled list inside the phone menu.
   *
   * On a phone these used to be five unlabelled icons in a row — a theme
   * toggle, results, how it works, dashboard and account all looked alike, and
   * the only way to tell them apart was to press one.
   */
  const destinations = [
    {
      to: "/results",
      label: "Placement results",
      Icon: BarChart3,
      current: path === "/results" || path === "/public",
      show: true,
    },
    { to: "/about", label: "How it works", Icon: Info, current: path === "/about", show: signedIn },
    { to: "/", label: "Dashboard", Icon: LayoutDashboard, current: path === "/", show: signedIn },
    { to: "/profile", label: "Account", Icon: User, current: path === "/profile", show: signedIn },
    { to: "/login", label: "Sign in", Icon: LogIn, current: false, show: !signedIn && path !== "/login" },
  ].filter((d) => d.show);

  const themeLabel = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  const ThemeIcon = theme === "dark" ? Sun : Moon;

  return (
    <nav ref={navRef} className="navbar animate-fade-in">
      {/* Brand — always links back home */}
      <div className="flex items-center gap-12">
        <Link to="/" className="navbar-brand" style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
          <Link2 size={20} aria-hidden="true" /> ChainProof
        </Link>
        <span
          className="badge badge-warning nav-testnet"
          style={{ fontSize: "var(--text-xs)" }}
          title="Running on a private practice blockchain for development/demo purposes — not a public or production network"
        >
          <span aria-hidden="true">●</span> <span className="nav-label">Test Network</span>
        </span>
      </div>

      {/* Wide screens: every destination, named. */}
      <div className="navbar-meta nav-wide">
        <button type="button" className="btn btn-ghost btn-sm" onClick={toggleTheme} aria-label={themeLabel} title={themeLabel}>
          <ThemeIcon size={16} />
        </button>
        {destinations.map(({ to, label, Icon, current }) => (
          <Link key={to} to={to} className={`btn btn-ghost btn-sm${current ? " nav-current" : ""}`} title={label}>
            <Icon size={14} /> <span className="nav-label">{label}</span>
          </Link>
        ))}
        {!signedIn && path !== "/signup" && (
          <Link to="/signup" className="btn btn-primary btn-sm" title="Create account">
            <UserPlus size={14} /> <span className="nav-label">Create account</span>
          </Link>
        )}
        {signedIn && (
          <button id="navbar-logout-btn" className="btn btn-ghost btn-sm" onClick={logout} title="Sign out">
            <LogOut size={14} /> <span className="nav-label">Sign out</span>
          </button>
        )}
      </div>

      {/* Phones: one button, and everything named behind it. */}
      <div className="nav-narrow">
        <button
          type="button"
          className="btn btn-ghost btn-sm nav-menu-button"
          aria-expanded={menuOpen}
          aria-controls="nav-menu"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X size={16} /> : <Menu size={16} />} Menu
        </button>
      </div>

      {menuOpen && (
        <div className="nav-menu" id="nav-menu">
          {destinations.map(({ to, label, Icon, current }) => (
            <Link key={to} to={to} className={`btn btn-ghost nav-menu-item${current ? " nav-current" : ""}`}>
              <Icon size={16} /> {label}
            </Link>
          ))}
          {!signedIn && path !== "/signup" && (
            <Link to="/signup" className="btn btn-primary nav-menu-item">
              <UserPlus size={16} /> Create account
            </Link>
          )}
          {signedIn && (
            <button className="btn btn-ghost nav-menu-item" onClick={logout}>
              <LogOut size={16} /> Sign out
            </button>
          )}
          <button type="button" className="btn btn-ghost nav-menu-item" onClick={toggleTheme}>
            <ThemeIcon size={16} /> {themeLabel}
          </button>
        </div>
      )}
    </nav>
  );
}
