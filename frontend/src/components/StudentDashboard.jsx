/**
 * StudentDashboard.jsx — Credential timeline and proof generator (layout only)
 *
 * Data-fetching lives in ../hooks/useStudentCredentials.js; the timeline and
 * proof generator live in ./student/ — this file owns the shared
 * per-credential visibility toggles (both pieces need it) and arranges layout.
 */

import React, { useState, useMemo } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { useStudentCredentials } from "../hooks/useStudentCredentials.js";
import CredentialTimeline from "./student/CredentialTimeline.jsx";
import ProofGenerator from "./student/ProofGenerator.jsx";
import { shortAddr } from "../utils/format.js";

export default function StudentDashboard() {
  const { user, actor } = useAuth();
  const { credentials, loading, isPlaced } = useStudentCredentials(user?.address);
  const [visibility, setVisibility] = useState({}); // credId -> bool

  const issuerCount = useMemo(
    () => new Set(credentials.map((c) => c.issuerAddress)).size,
    [credentials]
  );

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
      <div className="flex items-center justify-between" style={{ marginBottom: 20 }}>
        <div>
          <div className="section-eyebrow">Student Portal</div>
          <h2 style={{ marginBottom: 4 }}>{actor?.name || "Student Dashboard"}</h2>
          <p style={{ margin: 0, maxWidth: 480 }}>
            This is your permanent record. There's nothing for you to do here yourself —
            as colleges and companies interact with you, verified records appear below
            automatically, and you decide what to include when you generate a proof.
          </p>
        </div>
        <span className="mono-addr">{shortAddr(user?.address)}</span>
      </div>

      {/* KPI strip */}
      <div className="kpi-strip">
        <div className="kpi">
          <span className={`kpi-n ${isPlaced ? "accent" : ""}`}>{isPlaced ? "Placed" : "Active"}</span>
          <span className="kpi-l">{isPlaced ? "Set automatically from an Offer record" : "No offer recorded yet"}</span>
        </div>
        <div className="kpi">
          <span className="kpi-n">{credentials.length}</span>
          <span className="kpi-l">Steps on your record</span>
        </div>
        <div className="kpi">
          <span className="kpi-n">{issuerCount}</span>
          <span className="kpi-l">{issuerCount === 1 ? "Party involved" : "Parties involved"}</span>
        </div>
      </div>

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
            studentAddress={user?.address}
            studentName={actor?.name}
          />
        </div>
      </div>
    </div>
  );
}
