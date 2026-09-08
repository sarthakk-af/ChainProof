/**
 * CollegeDashboard.jsx — Placement cell portal (layout only)
 *
 * Data-fetching lives in ../hooks/useCollegeMetrics.js,
 * ../hooks/useCollegeVisits.js, and ../hooks/useCollegeStudents.js; the
 * visually-distinct sections live in ./college/ (plus the shared student
 * list) — this file just arranges them and owns which student is selected,
 * so picking one from the registry fills in the issue-credential form
 * instead of requiring a college employee to already know a wallet address.
 *
 * Layout: a compact KPI strip up top, then wide readable content (the visit
 * feed — what's actually happening) on the left, with the action forms
 * (student picker, issue credential, announce visit) grouped into a sticky
 * rail on the right, so acting doesn't require scrolling away from context.
 */

import React, { useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { useCollegeMetrics } from "../hooks/useCollegeMetrics.js";
import { useCollegeVisits } from "../hooks/useCollegeVisits.js";
import { useCollegeStudents } from "../hooks/useCollegeStudents.js";
import StudentList from "./shared/StudentList.jsx";
import IssueCredentialForm from "./college/IssueCredentialForm.jsx";
import VisitAnnouncementForm from "./college/VisitAnnouncementForm.jsx";
import VisitsFeed from "./college/VisitsFeed.jsx";

export default function CollegeDashboard() {
  const { user, actor } = useAuth();
  const metrics = useCollegeMetrics(user?.address);
  const visits = useCollegeVisits(user?.address);
  const collegeStudents = useCollegeStudents(user?.address);
  const [selectedStudent, setSelectedStudent] = useState(null);

  return (
    <div className="page-container animate-fade-in-up">
      {/* Header */}
      <div className="section-eyebrow">College Portal</div>
      <h2 style={{ marginBottom: 4 }}>{actor?.name || "College Dashboard"}</h2>
      <p style={{ marginBottom: 20 }}>Issue credentials, manage placements, and publish company visits.</p>

      {/* Typical workflow, so it's clear what order things happen in */}
      <div className="glass-card p-16 flex items-center gap-16 flex-wrap animate-fade-in-up" style={{ marginBottom: 24 }}>
        <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontWeight: 600 }}>TYPICAL FLOW:</span>
        {["Announce a company visit", "Students get interviewed", "Issue credentials as it happens", "Placement % updates itself"].map((s, i, arr) => (
          <React.Fragment key={s}>
            <span className="pipeline-stage">{s}</span>
            {i < arr.length - 1 && <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>→</span>}
          </React.Fragment>
        ))}
      </div>

      {/* ── KPI Strip ── */}
      {metrics.loading ? (
        <div className="flex justify-center" style={{ marginBottom: 28 }}>
          <div className="spinner" />
        </div>
      ) : (
        <div className="kpi-strip">
          <div className="kpi">
            <span className="kpi-n accent">{metrics.placementPct}%</span>
            <span className="kpi-l">Placement rate — {metrics.totalPlaced} of {metrics.totalRegistered} students</span>
          </div>
          <div className="kpi">
            <span className="kpi-n">{metrics.totalRegistered}</span>
            <span className="kpi-l">Registered students</span>
          </div>
          <div className="kpi">
            <span className="kpi-n">{visits.visits.length}</span>
            <span className="kpi-l">Company visits announced</span>
          </div>
          <div className="kpi">
            <span className="kpi-n">{metrics.totalPlaced}</span>
            <span className="kpi-l">With an Offer credential</span>
          </div>
        </div>
      )}

      <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", borderLeft: "2px solid var(--accent-warning)", paddingLeft: 12, marginBottom: 32 }}>
        The placement rate above is calculated automatically as{" "}
        <strong style={{ color: "var(--text-secondary)" }}>(Placed / Total Registered) × 100</strong>{" "}
        — the same number anyone can independently verify on the public dashboard.
      </p>

      <div className="dash-body">
        {/* ── Wide column: what's actually happening ── */}
        <div>
          <div className="section-eyebrow" style={{ marginBottom: 12 }}>Company Visit Announcements</div>
          <VisitsFeed visits={visits.visits} loading={visits.loading} />
        </div>

        {/* ── Rail: actions ── */}
        <div className="rail">
          <p className="rail-title">Registered Students ({collegeStudents.students.length})</p>
          <div>
            <p style={{ fontSize: "0.8rem", marginBottom: 10 }}>
              Select a student to fill in their wallet address below.
            </p>
            <div style={{ maxHeight: 200, overflowY: "auto" }}>
              <StudentList
                students={collegeStudents.students}
                loading={collegeStudents.loading}
                activeAddress={selectedStudent?.address}
                onSelect={(s) => setSelectedStudent(s)}
              />
            </div>
          </div>

          <div>
            <p className="rail-title">Issue Credential</p>
            <IssueCredentialForm
              presetAddress={selectedStudent?.address}
              onIssued={() => {
                metrics.refresh();
                collegeStudents.refresh();
              }}
            />
          </div>

          <div>
            <p className="rail-title">Announce a Visit</p>
            <VisitAnnouncementForm onAnnounced={visits.refresh} />
          </div>
        </div>
      </div>
    </div>
  );
}
