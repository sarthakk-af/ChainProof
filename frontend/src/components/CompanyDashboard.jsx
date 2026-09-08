/**
 * CompanyDashboard.jsx — Recruiter terminal (layout only)
 *
 * Data-fetching lives in ../hooks/useStudentList.js; the candidate table and
 * the pipeline-action panel live in ./company/ — this file just arranges
 * them and owns which student is currently selected (shared between the
 * two). Layout: a KPI strip up top, the candidate table as wide primary
 * content, and the action panel as a sticky rail beside it.
 */

import React, { useState, useMemo } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { useStudentList } from "../hooks/useStudentList.js";
import CandidateTable from "./company/CandidateTable.jsx";
import PipelineActionPanel from "./company/PipelineActionPanel.jsx";

export default function CompanyDashboard() {
  const { actor } = useAuth();
  const { students, loading, refresh } = useStudentList();
  const [activeStudent, setActiveStudent] = useState(null);

  const counts = useMemo(() => {
    const c = { Shortlist: 0, Interview: 0, Offer: 0 };
    for (const s of students) {
      if (s.highestCredentialStage && c[s.highestCredentialStage] !== undefined) {
        c[s.highestCredentialStage]++;
      }
    }
    return c;
  }, [students]);

  return (
    <div className="page-container animate-fade-in-up">
      {/* Header */}
      <div className="section-eyebrow">Company Terminal</div>
      <h2 style={{ marginBottom: 4 }}>{actor?.name || "Company Dashboard"}</h2>
      <p style={{ marginBottom: 24 }}>
        Progress student candidates through the recruitment pipeline on-chain.
        Every status change is a permanent, auditable record.
      </p>

      {/* Pipeline legend */}
      <div className="glass-card p-16 flex items-center gap-16 flex-wrap animate-fade-in-up" style={{ marginBottom: 28 }}>
        <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontWeight: 600 }}>PIPELINE:</span>
        {["Application Received", "Shortlisted", "Interviewed", "Offer / Rejection"].map((s, i) => (
          <React.Fragment key={s}>
            <span className="pipeline-stage">{s}</span>
            {i < 3 && <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>→</span>}
          </React.Fragment>
        ))}
      </div>

      {/* KPI strip */}
      <div className="kpi-strip">
        <div className="kpi">
          <span className="kpi-n">{counts.Shortlist}</span>
          <span className="kpi-l">Shortlisted</span>
        </div>
        <div className="kpi">
          <span className="kpi-n">{counts.Interview}</span>
          <span className="kpi-l">Interviewed</span>
        </div>
        <div className="kpi">
          <span className="kpi-n accent">{counts.Offer}</span>
          <span className="kpi-l">Offers made</span>
        </div>
        <div className="kpi">
          <span className="kpi-n">{students.length}</span>
          <span className="kpi-l">Registered students visible</span>
        </div>
      </div>

      <div className="dash-body">
        {/* ── Wide column: candidate table ── */}
        <div>
          <div className="section-eyebrow" style={{ marginBottom: 12 }}>
            Registered Students ({students.length})
          </div>
          <CandidateTable
            students={students}
            loading={loading}
            activeAddress={activeStudent?.address}
            onSelect={(s) => setActiveStudent(s)}
          />
        </div>

        {/* ── Rail: pipeline actions ── */}
        <div className="rail">
          <p className="rail-title">Pipeline Actions</p>
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
