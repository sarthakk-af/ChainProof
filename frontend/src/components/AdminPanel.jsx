/**
 * AdminPanel.jsx — Platform-admin verification queue.
 *
 * Separate from the normal user auth flow entirely: admins log in with their
 * own username/password (see backend's /admin/auth/login) to get a
 * short-lived admin session token, rather than everyone sharing one static
 * key — that's what lets every approve/reject decision be attributed to an
 * actual person (see the "Recent Decisions" log below). The shared
 * ADMIN_API_KEY still exists, but only to bootstrap a new admin account
 * (backend's POST /admin/admins) — it can't approve or reject anything
 * itself. Visit /admin directly to reach this page (see App.jsx's plain
 * pathname check).
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  ClipboardList,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  Inbox,
  Check,
  X,
  ExternalLink,
  CheckCircle2,
  XCircle,
  IdCard,
  LogIn,
  LogOut,
  UserCircle2,
} from "lucide-react";
import { shortAddr } from "../utils/format.js";

const BASE_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";
const SESSION_STORAGE_KEY = "chainproof_admin_session"; // { token, username }

const STATUS_BADGE = {
  Pending: "badge-warning",
  Active: "badge-success",
  Rejected: "badge-danger",
};

function loadSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

export default function AdminPanel() {
  const [session, setSession] = useState(loadSession);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const [statusFilter, setStatusFilter] = useState("Pending");
  const [actors, setActors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [confirming, setConfirming] = useState(null); // { address, action } awaiting confirmation, or null
  const [actingOn, setActingOn] = useState(null); // address currently mid-request, or null
  const [rejectReason, setRejectReason] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [actionLog, setActionLog] = useState([]);
  const [logLoading, setLogLoading] = useState(false);

  const clearSession = useCallback(() => {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    setSession(null);
  }, []);

  const adminFetch = useCallback(
    async (path, options = {}) => {
      const res = await fetch(`${BASE_URL}${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${session?.token}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
      return data;
    },
    [session]
  );

  const handleLogin = async (e) => {
    e.preventDefault();
    if (loginLoading) return;
    setLoginLoading(true);
    setLoginError("");
    try {
      const res = await fetch(`${BASE_URL}/admin/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: loginUsername.trim(), password: loginPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Login failed");
      const newSession = { token: data.token, username: data.username };
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(newSession));
      setSession(newSession);
      setLoginPassword("");
    } catch (err) {
      setLoginError(err.message || "Login failed");
    } finally {
      setLoginLoading(false);
    }
  };

  const fetchActors = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError("");
    try {
      const query = statusFilter === "All" ? "" : `?status=${statusFilter}`;
      const { actors: list } = await adminFetch(`/admin/actors${query}`);
      setActors(list);
    } catch (err) {
      setError(err.message);
      if (err.message.toLowerCase().includes("session")) {
        clearSession();
      }
    } finally {
      setLoading(false);
    }
  }, [session, statusFilter, adminFetch, clearSession]);

  useEffect(() => { fetchActors(); }, [fetchActors]);

  const fetchLog = useCallback(async () => {
    if (!session) return;
    setLogLoading(true);
    try {
      const { actions } = await adminFetch("/admin/actions?limit=50");
      setActionLog(actions);
    } catch {
      setActionLog([]);
    } finally {
      setLogLoading(false);
    }
  }, [session, adminFetch]);

  useEffect(() => { if (showLog) fetchLog(); }, [showLog, fetchLog]);

  const handleAction = async (address, action, reason) => {
    // See frontend's IssueCredentialForm.jsx handleIssue for why this checks
    // the in-flight state directly rather than trusting the button's disabled/hidden state.
    if (actingOn) return;
    setActionError("");
    setConfirming(null);
    setActingOn(address);
    try {
      await adminFetch(`/admin/actors/${address}/${action}`, {
        method: "POST",
        body: action === "reject" ? JSON.stringify({ reason: reason || "" }) : undefined,
      });
      await fetchActors();
      if (showLog) fetchLog();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActingOn(null);
      setRejectReason("");
    }
  };

  if (!session) {
    return (
      <div className="page-container animate-fade-in-up" style={{ maxWidth: 480, marginTop: 100 }}>
        <div className="section-eyebrow">Platform Admin</div>
        <h2 style={{ marginBottom: 20 }}>Admin Sign In</h2>
        <form className="glass-card p-32 flex flex-col gap-16" onSubmit={handleLogin} noValidate>
          <div className="form-group">
            <label htmlFor="admin-username">Username</label>
            <input
              id="admin-username"
              type="text"
              value={loginUsername}
              onChange={(e) => setLoginUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="admin-password">Password</label>
            <input
              id="admin-password"
              type="password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {loginError && (
            <div className="alert alert-danger" role="alert">
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{loginError}</span>
            </div>
          )}
          <button type="submit" className="btn btn-primary btn-lg" disabled={loginLoading}>
            {loginLoading ? (
              <><div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Signing in…</>
            ) : (
              <><LogIn size={16} /> Sign In</>
            )}
          </button>
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0 }}>
            No account yet? Ask whoever holds the platform's shared bootstrap key to create one via
            <code style={{ margin: "0 4px" }}>POST /admin/admins</code>.
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="page-container animate-fade-in-up">
      <div className="flex items-center justify-between" style={{ flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="section-eyebrow">Platform Admin</div>
          <h2 style={{ marginBottom: 4 }}>Institution Verification Queue</h2>
        </div>
        <div className="flex items-center gap-8">
          <span
            className="badge badge-none"
            style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            title="Every decision below is attributed to this account"
          >
            <UserCircle2 size={13} /> {session.username}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={clearSession}>
            <LogOut size={14} /> Sign Out
          </button>
        </div>
      </div>
      <p style={{ marginBottom: 24 }}>
        Approve or reject Colleges and Companies before they can act on the platform.
      </p>

      <div className="flex items-center gap-8" style={{ marginBottom: 20, flexWrap: "wrap" }}>
        {["Pending", "Active", "Rejected", "All"].map((s) => (
          <button
            key={s}
            className={`btn btn-sm ${statusFilter === s ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setStatusFilter(s)}
          >
            {s}
          </button>
        ))}
        <button
          className={`btn btn-sm ${showLog ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setShowLog((v) => !v)}
          style={{ marginLeft: "auto" }}
        >
          <ClipboardList size={14} /> Recent Decisions
        </button>
        <button className="btn btn-ghost btn-sm" onClick={fetchActors}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {showLog && (
        <div className="glass-card p-16" style={{ marginBottom: 20 }}>
          <div className="section-eyebrow" style={{ marginBottom: 10 }}>
            Recent Verification Decisions
          </div>
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: -4, marginBottom: 12 }}>
            A permanent record of every approve/reject decision — who decided it, who was affected,
            when, and why.
          </p>
          {logLoading ? (
            <div className="flex justify-center" style={{ padding: 16 }}>
              <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
            </div>
          ) : actionLog.length === 0 ? (
            <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>No decisions recorded yet.</p>
          ) : (
            <div className="flex flex-col gap-8">
              {actionLog.map((a) => (
                <div
                  key={a.id}
                  style={{ fontSize: "0.8rem", borderBottom: "1px solid var(--border-card)", paddingBottom: 8 }}
                >
                  <span
                    className={`badge ${a.action === "actor_approved" ? "badge-success" : "badge-danger"}`}
                    style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                  >
                    {a.action === "actor_approved" ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                    {a.action === "actor_approved" ? "Approved" : "Rejected"}
                  </span>{" "}
                  <strong>{a.actor_name || shortAddr(a.actor_address)}</strong>{" "}
                  <span style={{ color: "var(--text-muted)" }}>
                    — {new Date(a.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                    {a.admin_username && (
                      <> · by <strong style={{ color: "var(--text-secondary)" }}>{a.admin_username}</strong></>
                    )}
                  </span>
                  {a.reason && (
                    <p style={{ margin: "4px 0 0", color: "var(--text-secondary)" }}>Reason: "{a.reason}"</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {actionError && (
        <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}>
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{actionError}</span>
        </div>
      )}
      {error && (
        <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}>
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center" style={{ padding: 40 }}>
          <div className="spinner" />
        </div>
      ) : actors.length === 0 ? (
        <div className="empty-state glass-card">
          <Inbox size={48} className="empty-state-icon" />
          <h3>Nothing here</h3>
          <p style={{ fontSize: "0.85rem" }}>No {statusFilter.toLowerCase()} actors right now.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-10">
          {actors.map((a) => (
            <div key={a.address} className="glass-card animate-fade-in-up" style={{ padding: "16px 20px" }}>
              <div className="flex items-center justify-between" style={{ flexWrap: "wrap", gap: 12 }}>
                <div>
                  <div className="flex items-center gap-8" style={{ marginBottom: 4 }}>
                    <strong style={{ fontFamily: "var(--font-head)" }}>{a.name}</strong>
                    <span className="badge badge-none">{a.role}</span>
                    <span className={`badge ${STATUS_BADGE[a.status] || "badge-none"}`}>{a.status}</span>
                    {a.rejectionCount > 0 && (
                      <span
                        className="badge badge-none"
                        style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                        title="Recorded on-chain and preserved across resubmission — never hidden by a later approval"
                      >
                        <AlertTriangle size={12} /> Previously rejected {a.rejectionCount}x
                      </span>
                    )}
                    {a.sharesNameWithAnother && (
                      <span
                        className="badge badge-warning"
                        style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                        title="Another registration uses this exact name. Not necessarily wrong — many real institutions share a name — but check the registration numbers differ before approving."
                      >
                        <AlertTriangle size={12} /> Name shared with another registration
                      </span>
                    )}
                  </div>
                  <span className="mono-addr" style={{ fontSize: "0.75rem" }}>{shortAddr(a.address, { head: 8, tail: 6 })}</span>
                  {a.role !== "Student" && (
                    a.registrationNumber ? (
                      <p style={{ fontSize: "0.78rem", marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
                        <IdCard size={12} />
                        <span className="mono-addr" style={{ fontSize: "0.75rem" }}>{a.registrationNumber}</span>
                        <span style={{ color: "var(--text-muted)" }}>
                          — {a.role === "Company" ? "look this CIN up on the MCA registry" : "look this ID up with the accrediting body"}
                        </span>
                      </p>
                    ) : (
                      <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: 6 }}>
                        No registration number on file.
                      </p>
                    )
                  )}
                  {a.website ? (
                    <p style={{ fontSize: "0.78rem", marginTop: 6, display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                      <ExternalLink size={12} />
                      <a href={a.website} target="_blank" rel="noopener noreferrer">{a.website}</a>
                      {a.websiteReachable === true ? (
                        <span
                          className="badge badge-success"
                          style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: "0.68rem" }}
                          title="A live request to this address got a response when the account registered"
                        >
                          <CheckCircle2 size={11} /> Site responded
                        </span>
                      ) : a.websiteReachable === false ? (
                        <span
                          className="badge badge-danger"
                          style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: "0.68rem" }}
                          title="A live request to this address failed or timed out when the account registered — doesn't necessarily mean it's fake, but worth a manual look"
                        >
                          <XCircle size={11} /> Could not reach this site
                        </span>
                      ) : (
                        <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>checking…</span>
                      )}
                    </p>
                  ) : a.role !== "Student" ? (
                    <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: 6 }}>
                      No website given — verify identity by other means before approving.
                    </p>
                  ) : null}
                  {a.status === "Rejected" && a.rejectionReason && (
                    <p style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: 6, maxWidth: 420 }}>
                      Reason given: "{a.rejectionReason}"
                    </p>
                  )}
                </div>
                {a.status === "Pending" && (
                  <div className="flex items-center gap-8">
                    {actingOn === a.address ? (
                      <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 8 }}>
                        <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                        Writing to the record…
                      </span>
                    ) : confirming?.address === a.address ? (
                      <>
                        <button
                          className={`btn btn-sm ${confirming.action === "approve" ? "btn-success" : "btn-danger"}`}
                          onClick={() => handleAction(a.address, confirming.action, rejectReason)}
                        >
                          {confirming.action === "approve" ? <Check size={14} /> : <X size={14} />}
                          Confirm {confirming.action === "approve" ? "Approve" : "Reject"}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => { setConfirming(null); setRejectReason(""); }}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="btn btn-success btn-sm" onClick={() => setConfirming({ address: a.address, action: "approve" })}>
                          <Check size={14} /> Approve
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => setConfirming({ address: a.address, action: "reject" })}>
                          <X size={14} /> Reject
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
              {confirming?.address === a.address && actingOn !== a.address && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border-card)" }}>
                  {confirming.action === "reject" ? (
                    <div className="form-group">
                      <label htmlFor={`reject-reason-${a.address}`}>Reason (shown to {a.name})</label>
                      <input
                        id={`reject-reason-${a.address}`}
                        type="text"
                        placeholder="e.g. Couldn't confirm this is an official institution — please resubmit with more detail"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        maxLength={500}
                        aria-describedby={`reject-reason-count-${a.address}`}
                      />
                      <span
                        id={`reject-reason-count-${a.address}`}
                        style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}
                      >
                        {rejectReason.length}/500
                      </span>
                    </div>
                  ) : (
                    <p style={{ fontSize: "0.85rem", margin: 0 }}>
                      This grants {a.name} full access to issue credentials{a.role === "College" ? "/announce visits" : ""} under this identity.
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
