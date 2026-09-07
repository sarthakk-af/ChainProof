/**
 * CompanyDashboard.jsx — Recruiter terminal (layout only)
 *
 * Data-fetching lives in ../hooks/useStudentList.js; the student registry and
 * the pipeline-action panel live in ./company/ — this file just arranges them
 * and owns which student is currently selected (shared between the two).
 */

import React, { useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { useStudentList } from "../hooks/useStudentList.js";
import StudentList from "./company/StudentList.jsx";
import PipelineActionPanel from "./company/PipelineActionPanel.jsx";

export default function CompanyDashboard() {
  const { actor } = useAuth();
  const { students, loading, refresh } = useStudentList();
  const [activeStudent, setActiveStudent] = useState(null);

  return (
    <div className="page-container animate-fade-in-up">
      {/* Header */}
      <div className="section-eyebrow">Company Terminal</div>
      <h2 style={{ marginBottom: 4 }}>{actor?.name || "Company Dashboard"}</h2>
      <p style={{ marginBottom: 32 }}>
        Progress student candidates through the recruitment pipeline on-chain.
        Every status change is a permanent, auditable record.
      </p>

      {/* Pipeline legend */}
      <div className="glass-card p-16 flex items-center gap-16 flex-wrap animate-fade-in-up" style={{ marginBottom: 32 }}>
        <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontWeight: 600 }}>PIPELINE:</span>
        {["Application Received", "Shortlisted", "Interviewed", "Offer / Rejection"].map((s, i) => (
          <React.Fragment key={s}>
            <span className="pipeline-stage">{s}</span>
            {i < 3 && <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>→</span>}
          </React.Fragment>
        ))}
      </div>

      <div className="grid-2" style={{ gap: 28 }}>
        {/* ── Student Registry ── */}
        <div>
          <div className="section-eyebrow" style={{ marginBottom: 12 }}>
            Registered Students ({students.length})
          </div>
          <StudentList
            students={students}
            loading={loading}
            activeAddress={activeStudent?.address}
            onSelect={(s) => setActiveStudent(s)}
          />
        </div>

        {/* ── Pipeline Action Panel ── */}
        <div>
          <div className="section-eyebrow" style={{ marginBottom: 12 }}>Pipeline Actions</div>
          <PipelineActionPanel
            activeStudent={activeStudent}
            onDeselect={() => setActiveStudent(null)}
            onIssued={refresh}
          />
        </div>
      </div>
    </div>
  );
}
