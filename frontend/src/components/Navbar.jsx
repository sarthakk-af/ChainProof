/**
 * Navbar.jsx — Sticky top navigation bar
 * Shows brand, signed-in email, on-chain role/status badge, and a sign-out button.
 */

import React from "react";
import { useAuth } from "../context/AuthContext.jsx";

const ROLE_BADGE_CLASS = {
  Student: "badge-student",
  College: "badge-college",
  Company: "badge-company",
};

function shortAddr(addr) {
  if (!addr) return "";
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

export default function Navbar() {
  const { status, user, actor, logout } = useAuth();

  return (
    <nav className="navbar animate-fade-in">
      {/* Brand */}
      <div className="flex items-center gap-12">
        <span className="navbar-brand"><span aria-hidden="true">⛓</span> ChainProof</span>
        {status === "authenticated" && (
          <span className="badge badge-success" style={{ fontSize: "0.68rem" }}>
            <span aria-hidden="true">●</span> Live
          </span>
        )}
      </div>

      {/* Right side */}
      <div className="navbar-meta">
        {window.location.pathname === "/public" ? (
          <a href="/" className="btn btn-ghost btn-sm">← Back to App</a>
        ) : (
          <a href="/public" className="btn btn-ghost btn-sm"><span aria-hidden="true">📊</span> Public Dashboard</a>
        )}
        {status === "authenticated" && user && (
          <>
            {actor && (
              <span className={`badge ${ROLE_BADGE_CLASS[actor.role] || "badge-none"}`}>
                {actor.role}
                {actor.status !== "Active" ? ` · ${actor.status}` : ""}
                {actor.name ? ` · ${actor.name}` : ""}
              </span>
            )}
            <span style={{ fontSize: "0.82rem", color: "var(--text-secondary)" }}>{user.email}</span>
            <span className="mono-addr" title={user.address}>
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
