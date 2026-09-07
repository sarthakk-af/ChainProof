/**
 * AdminPanel.jsx — Platform-admin verification queue.
 *
 * Separate from the normal user auth flow entirely: this talks to the
 * /admin/* API built in Phase 2, which uses its own shared-secret header
 * (x-admin-key) rather than a per-user JWT. Visit /admin directly to reach
 * this page (see App.jsx's plain pathname check).
 */

import React, { useState, useEffect, useCallback } from "react";

const BASE_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";
const ADMIN_KEY_STORAGE = "chainproof_admin_key";

function shortAddr(addr) { return addr?.slice(0, 8) + "…" + addr?.slice(-6); }

const STATUS_BADGE = {
  Pending: "badge-warning",
  Active: "badge-success",
  Rejected: "badge-danger",
};

export default function AdminPanel() {
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem(ADMIN_KEY_STORAGE) || "");
  const [keyInput, setKeyInput] = useState("");
  const [statusFilter, setStatusFilter] = useState("Pending");
  const [actors, setActors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [confirmingReject, setConfirmingReject] = useState(null); // address awaiting reject confirmation, or null

  const adminFetch = useCallback(
    async (path, options = {}) => {
      const res = await fetch(`${BASE_URL}${path}`, {
        ...options,
        headers: { "x-admin-key": adminKey, "Content-Type": "application/json", ...options.headers },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
      return data;
    },
    [adminKey]
  );

  const fetchActors = useCallback(async () => {
    if (!adminKey) return;
    setLoading(true);
    setError("");
    try {
      const query = statusFilter === "All" ? "" : `?status=${statusFilter}`;
      const { actors: list } = await adminFetch(`/admin/actors${query}`);
      setActors(list);
    } catch (err) {
      setError(err.message);
      if (err.message.toLowerCase().includes("unauthorized")) {
        sessionStorage.removeItem(ADMIN_KEY_STORAGE);
        setAdminKey("");
      }
    } finally {
      setLoading(false);
    }
  }, [adminKey, statusFilter, adminFetch]);

  useEffect(() => { fetchActors(); }, [fetchActors]);

  const handleKeySubmit = (e) => {
    e.preventDefault();
    sessionStorage.setItem(ADMIN_KEY_STORAGE, keyInput);
    setAdminKey(keyInput);
  };

  const handleAction = async (address, action) => {
    setActionError("");
    setConfirmingReject(null);
    try {
      await adminFetch(`/admin/actors/${address}/${action}`, { method: "POST" });
      fetchActors();
    } catch (err) {
      setActionError(err.message);
    }
  };

  if (!adminKey) {
    return (
      <div className="page-container animate-fade-in-up" style={{ maxWidth: 480, marginTop: 100 }}>
        <div className="section-eyebrow">Platform Admin</div>
        <h2 style={{ marginBottom: 20 }}>Enter Admin Key</h2>
        <form className="glass-card p-32 flex flex-col gap-16" onSubmit={handleKeySubmit}>
          <div className="form-group">
            <label htmlFor="admin-key">Admin API Key</label>
            <input
              id="admin-key"
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="ADMIN_API_KEY from backend/.env"
              required
            />
          </div>
          <button type="submit" className="btn btn-primary btn-lg">Continue</button>
        </form>
      </div>
    );
  }

  return (
    <div className="page-container animate-fade-in-up">
      <div className="section-eyebrow">Platform Admin</div>
      <h2 style={{ marginBottom: 4 }}>Institution Verification Queue</h2>
      <p style={{ marginBottom: 24 }}>
        Approve or reject Colleges and Companies before they can act on the platform.
      </p>

      <div className="flex items-center gap-8" style={{ marginBottom: 20 }}>
        {["Pending", "Active", "Rejected", "All"].map((s) => (
          <button
            key={s}
            className={`btn btn-sm ${statusFilter === s ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setStatusFilter(s)}
          >
            {s}
          </button>
        ))}
        <button className="btn btn-ghost btn-sm" onClick={fetchActors} style={{ marginLeft: "auto" }}>
          🔄 Refresh
        </button>
      </div>

      {actionError && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          <span>❌</span><span>{actionError}</span>
        </div>
      )}
      {error && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          <span>❌</span><span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center" style={{ padding: 40 }}>
          <div className="spinner" />
        </div>
      ) : actors.length === 0 ? (
        <div className="empty-state glass-card">
          <div className="empty-state-icon">📭</div>
          <h3>Nothing here</h3>
          <p style={{ fontSize: "0.85rem" }}>No {statusFilter.toLowerCase()} actors right now.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-10">
          {actors.map((a) => (
            <div key={a.address} className="glass-card animate-fade-in-up" style={{ padding: "16px 20px" }}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-8" style={{ marginBottom: 4 }}>
                    <strong style={{ fontFamily: "var(--font-head)" }}>{a.name}</strong>
                    <span className="badge badge-none">{a.role}</span>
                    <span className={`badge ${STATUS_BADGE[a.status] || "badge-none"}`}>{a.status}</span>
                  </div>
                  <span className="mono-addr" style={{ fontSize: "0.75rem" }}>{shortAddr(a.address)}</span>
                </div>
                {a.status === "Pending" && (
                  <div className="flex gap-8">
                    <button className="btn btn-success btn-sm" onClick={() => handleAction(a.address, "approve")}>
                      ✅ Approve
                    </button>
                    {confirmingReject === a.address ? (
                      <>
                        <button className="btn btn-danger btn-sm" onClick={() => handleAction(a.address, "reject")}>
                          Confirm Reject
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setConfirmingReject(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button className="btn btn-danger btn-sm" onClick={() => setConfirmingReject(a.address)}>
                        ❌ Reject
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
