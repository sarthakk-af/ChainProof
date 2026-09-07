/**
 * StudentDashboard.jsx — Credential timeline and proof generator (layout only)
 *
 * Data-fetching lives in ../hooks/useStudentCredentials.js; the timeline and
 * proof generator live in ./student/ — this file owns the shared
 * per-credential visibility toggles (both pieces need it) and arranges layout.
 */

import React, { useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { useStudentCredentials } from "../hooks/useStudentCredentials.js";
import CredentialTimeline from "./student/CredentialTimeline.jsx";
import ProofGenerator from "./student/ProofGenerator.jsx";

function shortAddr(addr) { return addr?.slice(0, 6) + "…" + addr?.slice(-4); }

export default function StudentDashboard() {
  const { user, actor } = useAuth();
  const { credentials, loading, isPlaced } = useStudentCredentials(user?.address);
  const [visibility, setVisibility] = useState({}); // credId -> bool

  const toggleVisibility = (id) =>
    setVisibility((prev) => ({ ...prev, [id]: !prev[id] }));

  if (loading) {
    return (
      <div className="page-container flex justify-center items-center" style={{ minHeight: 300 }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="page-container animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
        <div>
          <div className="section-eyebrow">Student Portal</div>
          <h2>{actor?.name || "Student Dashboard"}</h2>
        </div>
        <div className="flex flex-col items-center gap-8">
          {isPlaced ? (
            <span className="badge badge-success" style={{ fontSize: "0.9rem", padding: "8px 18px" }}>
              <span aria-hidden="true">🎉</span> Placed
            </span>
          ) : (
            <span className="badge badge-none">Not Placed Yet</span>
          )}
          <span className="mono-addr">{shortAddr(user?.address)}</span>
        </div>
      </div>

      <div className="divider" />

      <div className="grid-2" style={{ gap: 28 }}>
        <div>
          <div className="section-eyebrow" style={{ marginBottom: 12 }}>Credential Timeline</div>
          <CredentialTimeline
            credentials={credentials}
            visibility={visibility}
            onToggleVisibility={toggleVisibility}
          />
        </div>

        <div>
          <div className="section-eyebrow" style={{ marginBottom: 12 }}>Cryptographic Proof</div>
          <ProofGenerator
            credentials={credentials}
            visibility={visibility}
            isPlaced={isPlaced}
            studentAddress={user?.address}
            studentName={actor?.name}
          />
        </div>
      </div>
    </div>
  );
}
