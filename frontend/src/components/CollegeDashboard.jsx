/**
 * CollegeDashboard.jsx — Placement cell portal (layout only)
 *
 * Data-fetching lives in ../hooks/useCollegeMetrics.js and
 * ../hooks/useCollegeVisits.js; the three visually-distinct sections live in
 * ./college/ — this file just arranges them.
 */

import React from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { useCollegeMetrics } from "../hooks/useCollegeMetrics.js";
import { useCollegeVisits } from "../hooks/useCollegeVisits.js";
import IssueCredentialForm from "./college/IssueCredentialForm.jsx";
import VisitAnnouncementForm from "./college/VisitAnnouncementForm.jsx";
import VisitsFeed from "./college/VisitsFeed.jsx";

export default function CollegeDashboard() {
  const { user, actor } = useAuth();
  const metrics = useCollegeMetrics(user?.address);
  const visits = useCollegeVisits(user?.address);

  return (
    <div className="page-container animate-fade-in-up">
      {/* Header */}
      <div className="section-eyebrow">College Portal</div>
      <h2 style={{ marginBottom: 4 }}>{actor?.name || "College Dashboard"}</h2>
      <p style={{ marginBottom: 32 }}>Issue credentials, manage placements, and publish company visits.</p>

      {/* ── Metrics Panel ── */}
      <div className="section-eyebrow" style={{ marginBottom: 12 }}>The Truth Layer — Placement Metrics</div>
      {metrics.loading ? (
        <div className="flex justify-center" style={{ marginBottom: 32 }}>
          <div className="spinner" />
        </div>
      ) : (
        <div className="grid-4 stagger-children animate-fade-in-up" style={{ marginBottom: 32 }}>
          <div className="stat-card">
            <div className="stat-label">Registered Students</div>
            <div className="stat-value">{metrics.totalRegistered}</div>
            <div className="stat-sub">Total on-chain</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Students Placed</div>
            <div className="stat-value" style={{ background: "linear-gradient(135deg, var(--accent-success), #00b07a)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
              {metrics.totalPlaced}
            </div>
            <div className="stat-sub">With Offer credentials</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Placement %</div>
            <div className="stat-value">{metrics.placementPct}%</div>
            <div className="stat-sub" style={{ color: "var(--accent-warning)", fontSize: "0.75rem" }}>
              Math-enforced · Cannot be gamed
            </div>
          </div>
          <div className="stat-card" style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div className="stat-label" style={{ marginBottom: 10 }}>Placement Progress</div>
            <div className="progress-bar-wrap">
              <div
                className="progress-bar-fill"
                style={{ width: `${Math.min(metrics.placementPct, 100)}%` }}
              />
            </div>
            <div style={{ textAlign: "right", fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 6 }}>
              {metrics.totalPlaced} / {metrics.totalRegistered}
            </div>
          </div>
        </div>
      )}

      <div className="alert alert-warning" style={{ marginBottom: 32, fontSize: "0.85rem" }}>
        <span aria-hidden="true">⚖️</span>
        <span>
          The placement formula is{" "}
          <strong>(Placed / Total Registered) × 100</strong>{" "}
          — computed directly from immutable blockchain state, scoped to this college only.
          No administrator can selectively exclude unplaced students to inflate this figure.
        </span>
      </div>

      <div className="grid-2" style={{ gap: 28 }}>
        {/* ── Issue Credential Form ── */}
        <div>
          <div className="section-eyebrow" style={{ marginBottom: 12 }}>Issue Credential</div>
          <IssueCredentialForm onIssued={metrics.refresh} />
        </div>

        {/* ── Company Visit Announcements ── */}
        <div>
          <div className="section-eyebrow" style={{ marginBottom: 12 }}>Company Visit Announcements</div>
          <VisitAnnouncementForm onAnnounced={visits.refresh} />
          <VisitsFeed visits={visits.visits} loading={visits.loading} />
        </div>
      </div>
    </div>
  );
}
