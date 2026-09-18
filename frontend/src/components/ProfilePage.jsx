/**
 * ProfilePage.jsx — "Who am I on this platform" for any role.
 *
 * Read-only by design (renaming/changing role would touch the on-chain
 * record, out of scope here) — this just answers "what does the system know
 * about me right now", reachable from the navbar at /profile.
 */

import React from "react";
import { useAuth } from "../context/AuthContext.jsx";

const ROLE_BADGE_CLASS = { Student: "badge-student", College: "badge-college", Company: "badge-company" };
const STATUS_BADGE_CLASS = {
  Active: "badge-success",
  Pending: "badge-warning",
  Rejected: "badge-danger",
  Suspended: "badge-warning",
};

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between" style={{ padding: "14px 0", borderBottom: "1px solid var(--border-card)" }}>
      <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </span>
      <span style={{ fontSize: "0.9rem", textAlign: "right" }}>{children}</span>
    </div>
  );
}

export default function ProfilePage() {
  const { user, actor, profile } = useAuth();

  return (
    <div className="page-container animate-fade-in-up" style={{ maxWidth: 640 }}>
      <header className="page-head">
        <div className="section-eyebrow">Your account</div>
        <h2>Account</h2>
        <p>What ChainProof currently knows about your account.</p>
      </header>

      <div className="glass-card p-24">
        <Row label="Email">{user?.email}</Row>
        <Row label="Wallet Address">
          <span className="mono-addr" title={user?.address}>{user?.address}</span>
        </Row>

        {actor ? (
          <>
            {/* A student's on-chain name is a placeholder by design; the real
                one comes from the college's roster, kept off-chain. */}
            <Row label="Name">{actor.role === "Student" ? profile?.fullName ?? "—" : actor.name}</Row>
            <Row label="Role">
              <span className={`badge ${ROLE_BADGE_CLASS[actor.role] || "badge-none"}`}>{actor.role}</span>
            </Row>
            <Row label="Verification Status">
              <span className={`badge ${STATUS_BADGE_CLASS[actor.status] || "badge-none"}`}>{actor.status}</span>
            </Row>
            {actor.role === "Student" && actor.college && (
              <Row label="Registered College">
                <span className="mono-addr" title={actor.college}>{actor.college}</span>
              </Row>
            )}
          </>
        ) : (
          <div style={{ padding: "14px 0" }}>
            <p style={{ fontSize: "0.85rem", margin: 0 }}>
              You haven't registered a role yet — go back to the app to choose Student, College, or Company.
            </p>
          </div>
        )}
      </div>

      <p style={{ fontSize: "0.78rem", marginTop: 16, color: "var(--text-muted)" }}>
        Your wallet is managed for you automatically — there's nothing to install or back up yourself.
      </p>
    </div>
  );
}
