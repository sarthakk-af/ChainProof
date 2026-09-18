/**
 * ServiceUnavailable.jsx — shown when a saved session can't be checked
 * because the backend isn't answering properly (down, starting up, or pointed
 * at a blockchain that was reset).
 *
 * The session is kept: the backend's own message says what's wrong, and the
 * page tries again by itself, so once the backend is back the dashboard simply
 * appears.
 */

import React, { useEffect } from "react";
import { CloudOff, RefreshCw } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";

const RETRY_MS = 5000;

export default function ServiceUnavailable() {
  const { serviceError, resumeSession, logout } = useAuth();

  useEffect(() => {
    const timer = setInterval(resumeSession, RETRY_MS);
    return () => clearInterval(timer);
  }, [resumeSession]);

  return (
    <div className="page-container page-status animate-fade-in-up">
      <CloudOff size={40} style={{ color: "var(--accent-warning)", marginBottom: 16 }} />
      <h2 style={{ marginBottom: 12 }}>The server isn't ready</h2>

      <div className="glass-card p-24" style={{ textAlign: "left", marginBottom: 20 }}>
        <p style={{ fontSize: "0.86rem", lineHeight: 1.7 }}>{serviceError}</p>
      </div>

      <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: 24 }}>
        You're still signed in. This page checks again every few seconds.
      </p>

      <div className="flex gap-12 justify-center">
        <button type="button" className="btn btn-primary" onClick={resumeSession}>
          <RefreshCw size={15} /> Try again
        </button>
        <button type="button" className="btn btn-ghost" onClick={logout}>Sign out</button>
      </div>
    </div>
  );
}
