/**
 * JoinCodePanel.jsx — The code a college hands its own students.
 *
 * This is what actually ties a Student's registration to some real contact
 * with this institution — picking a name off a public dropdown alone proves
 * nothing (see backend/src/routes/me.js's /register, which now requires this
 * code to match before a Student can bind to a college).
 */
import React, { useState, useEffect, useCallback } from "react";
import { Copy, Check, RotateCw } from "lucide-react";
import { api } from "../../utils/api.js";

export default function JoinCodePanel() {
  const [joinCode, setJoinCode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/me/join-code");
      setJoinCode(data.joinCode);
    } catch (err) {
      setError(err.message || "Could not load your invite code.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(joinCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be blocked (permissions, non-HTTPS context) —
      // the code is still shown on screen either way, so this isn't fatal.
    }
  };

  const handleRegenerate = async () => {
    if (regenerating) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setRegenerating(true);
    setError("");
    try {
      const data = await api.post("/me/join-code/regenerate");
      setJoinCode(data.joinCode);
    } catch (err) {
      setError(err.message || "Could not generate a new code.");
    } finally {
      setRegenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="glass-card p-16 flex items-center gap-8">
        <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
        <span style={{ fontSize: "0.85rem" }}>Loading your invite code…</span>
      </div>
    );
  }

  return (
    <div className="glass-card p-16 flex flex-col gap-10">
      <p style={{ fontSize: "0.8rem", margin: 0 }}>
        Share this code with your own students — they need it to register under your college.
      </p>
      {error && <div className="alert alert-danger" role="alert"><span>{error}</span></div>}
      {joinCode && (
        <div className="flex items-center gap-8">
          <div
            className="mono-addr"
            style={{ fontSize: "1.1rem", letterSpacing: "0.2em", padding: "8px 14px", flex: 1, textAlign: "center" }}
          >
            {joinCode}
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={handleCopy}>
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      {confirming && (
        <div className="alert alert-warning" role="alert" style={{ fontSize: "0.78rem" }}>
          <span>
            Generating a new code immediately stops the old one from working for anyone who
            hasn't registered yet. Already-registered students are unaffected.
          </span>
        </div>
      )}
      <div className="flex gap-8">
        <button type="button" className="btn btn-ghost btn-sm" onClick={handleRegenerate} disabled={regenerating}>
          <RotateCw size={14} /> {regenerating ? "Generating…" : confirming ? "Confirm New Code" : "Generate New Code"}
        </button>
        {confirming && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
