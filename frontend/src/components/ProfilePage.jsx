/**
 * ProfilePage.jsx — "Who am I on this platform", and the few things you can
 * actually do to your own account.
 *
 * It used to be read-only: your email, your wallet, your role, and no way to
 * change anything. Changing your password meant pretending to have forgotten
 * it and waiting for an email; a session left open on a lab computer had no
 * answer at all. Neither of those is a design decision, so both are here now.
 *
 * What stays read-only is anything the record depends on — your name, your
 * role, your college. Those come from the roster and the chain.
 */

import React, { useState } from "react";
import { KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../utils/api.js";
import PasswordInput from "./shared/PasswordInput.jsx";

const ROLE_BADGE_CLASS = { Student: "badge-student", College: "badge-college", Company: "badge-company" };
const STATUS_BADGE_CLASS = {
  Active: "badge-success",
  Pending: "badge-warning",
  Rejected: "badge-danger",
  Suspended: "badge-warning",
};

function Row({ label, children }) {
  return (
    <div className="account-row">
      <span className="account-row-label">{label}</span>
      <span className="account-row-value">{children}</span>
    </div>
  );
}

export default function ProfilePage() {
  const { user, actor, profile, setToken, logout } = useAuth();
  const [changing, setChanging] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const changePassword = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy("password");
    setError("");
    setNotice("");
    try {
      const result = await api.post("/auth/change-password", { currentPassword, newPassword });
      // The server ends every session, including this one, and hands back a
      // fresh token so the person who just changed it stays where they are.
      if (result.token) setToken(result.token);
      setNotice(result.message);
      setCurrentPassword("");
      setNewPassword("");
      setChanging(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  const signOutEverywhere = async () => {
    if (busy) return;
    setBusy("sessions");
    setError("");
    try {
      await api.post("/auth/sign-out-everywhere", {});
      await logout();
    } catch (err) {
      setError(err.message);
      setBusy("");
    }
  };

  return (
    <div className="page-container animate-fade-in-up" style={{ maxWidth: 640 }}>
      <header className="page-head">
        <div className="section-eyebrow">Your account</div>
        <h2>Account</h2>
        <p>What ChainProof knows about you, and what you can change.</p>
      </header>

      {error && (
        <div className="alert alert-danger" role="alert" style={{ marginBottom: "var(--space-4)" }}>
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="alert alert-info" role="status" style={{ marginBottom: "var(--space-4)" }}>
          <span>{notice}</span>
        </div>
      )}

      <section className="glass-card p-24" style={{ marginBottom: "var(--space-4)" }}>
        <h3 className="card-title">Who you are</h3>
        <Row label="Email">{user?.email}</Row>
        {actor && (
          <>
            {/* A student's on-chain name is a placeholder by design; the real
                one comes from the college's roster, kept off-chain. */}
            <Row label="Name">{actor.role === "Student" ? profile?.fullName ?? "—" : actor.name}</Row>
            <Row label="Role">
              <span className={`badge ${ROLE_BADGE_CLASS[actor.role] || "badge-none"}`}>{actor.role}</span>
            </Row>
            <Row label="Status">
              <span className={`badge ${STATUS_BADGE_CLASS[actor.status] || "badge-none"}`}>{actor.status}</span>
            </Row>
          </>
        )}
        {!actor && (
          <p className="form-hint" style={{ marginTop: "var(--space-3)" }}>
            You haven&apos;t chosen a role yet — go to your dashboard to say whether you are a
            student, the placement cell or a company.
          </p>
        )}
      </section>

      <section className="glass-card p-24" style={{ marginBottom: "var(--space-4)" }}>
        <h3 className="card-title">Signing in</h3>

        {changing ? (
          <form onSubmit={changePassword} className="flex flex-col gap-12" style={{ marginTop: "var(--space-3)" }}>
            <div className="form-group">
              <label htmlFor="ac-current">Current password</label>
              <PasswordInput
                id="ac-current"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="ac-new">New password</label>
              <PasswordInput
                id="ac-new"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters, including a number"
                required
              />
              <p className="form-hint">
                Changing it signs out every other device you are signed in on.
              </p>
            </div>
            <div className="flex gap-8" style={{ flexWrap: "wrap" }}>
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy === "password"}>
                {busy === "password" ? <span className="spinner" /> : "Change password"}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => { setChanging(false); setCurrentPassword(""); setNewPassword(""); }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="flex gap-8" style={{ marginTop: "var(--space-3)", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChanging(true)}>
              <KeyRound size={14} /> Change password
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={signOutEverywhere}
              disabled={busy === "sessions"}
            >
              {busy === "sessions" ? <span className="spinner" /> : <><LogOut size={14} /> Sign out everywhere</>}
            </button>
          </div>
        )}
      </section>

      <section className="glass-card p-24">
        <div className="flex items-start gap-12">
          <ShieldCheck size={18} style={{ color: "var(--accent-primary)", flexShrink: 0, marginTop: 2 }} />
          <div>
            <h3 className="card-title">Your wallet, and what can be deleted</h3>
            <p className="card-lead">
              The wallet below is managed for you — nothing to install, nothing to back up.
            </p>
            <div className="mono-addr" style={{ fontSize: "var(--text-xs)", marginTop: "var(--space-2)" }} title={user?.address}>
              {user?.address}
            </div>
            {/* Said plainly, because "delete my account" cannot mean what people
                expect it to mean here, and finding that out later would feel
                like a trick. */}
            <p className="form-hint" style={{ marginTop: "var(--space-3)" }}>
              Your login, your profile and your resume can be removed — ask your placement
              cell. What was signed on the blockchain stays: a drive, a result, an accepted
              offer. It carries a wallet address, never your name.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
