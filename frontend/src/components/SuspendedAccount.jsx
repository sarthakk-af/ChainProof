/**
 * SuspendedAccount.jsx — what a suspended account sees.
 *
 * Its own screen, rather than a dashboard where every button quietly fails.
 * Landing on the normal console and finding that nothing works, with no
 * explanation anywhere, is the kind of dead end this version exists to remove.
 *
 * It also says the part that is easy to leave out and matters most to whoever
 * is reading it: nothing they already did has been deleted. A suspension stops
 * an account acting; it never edits a record. The drives they posted, the
 * results they recorded and the offers they made all still stand.
 */

import React from "react";
import { Ban, LogOut } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";

export default function SuspendedAccount() {
  const { actor, logout } = useAuth();

  return (
    <div className="page-container page-status animate-fade-in-up">
      <Ban size={40} style={{ color: "var(--accent-warning)", marginBottom: "var(--space-4)" }} />
      <h2 style={{ marginBottom: "var(--space-3)" }}>This account is suspended</h2>

      <p style={{ marginBottom: "var(--space-4)" }}>
        <strong>{actor?.name}</strong> can't post, apply or record anything at the moment.
        The platform administrator suspended it, and only they can lift that.
      </p>

      <div className="glass-card p-24" style={{ textAlign: "left", marginBottom: "var(--space-5)" }}>
        <p style={{ fontSize: "var(--text-sm)", lineHeight: 1.7 }}>
          Everything this account already recorded is untouched. Any drive it posted,
          result it recorded or offer it answered stays exactly as it was signed — a
          suspension stops an account from acting, it never rewrites what already
          happened.
        </p>
      </div>

      <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginBottom: "var(--space-5)" }}>
        If you think this is a mistake, speak to your placement cell — they can raise it
        with the administrator.
      </p>

      <button className="btn btn-ghost" onClick={logout}>
        <LogOut size={16} /> Sign out
      </button>
    </div>
  );
}
