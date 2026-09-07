/**
 * PublicDashboard.jsx — Public accountability dashboard
 *
 * No login required. This is the page that makes the platform's core promise
 * real: anyone can see placement stats computed straight from on-chain data,
 * without any college or company being able to hide or inflate them. Reads
 * from the /public/* backend routes, which are pure DB aggregation (see
 * backend/src/routes/public.js) — cheap enough for anonymous traffic.
 */

import React, { useState, useEffect, useCallback } from "react";
import { api } from "../utils/api.js";

function shortAddr(addr) { return addr?.slice(0, 6) + "…" + addr?.slice(-4); }
function formatDate(unixSeconds) {
  return new Date(Number(unixSeconds) * 1000).toLocaleDateString("en-IN", {
    dateStyle: "medium",
  });
}

export default function PublicDashboard() {
  const [overview, setOverview] = useState(null);
  const [colleges, setColleges] = useState([]);
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchAll = useCallback(async () => {
    setError("");
    try {
      const [overviewData, collegesData, visitsData] = await Promise.all([
        api.get("/public/overview"),
        api.get("/public/colleges"),
        api.get("/public/visits?limit=15"),
      ]);
      setOverview(overviewData);
      setColleges([...collegesData.colleges].sort((a, b) => b.percentage - a.percentage));
      setVisits(visitsData.visits);
    } catch (err) {
      setError(err.message || "Could not load public data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 15000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  if (loading) {
    return (
      <div className="page-container flex justify-center items-center" style={{ minHeight: 300 }}>
        <div className="spinner" />
      </div>
    );
  }

  // The first load can fail (backend down, network hiccup) before `overview`
  // is ever populated — show the error plainly instead of crashing on
  // `overview.totalColleges` below.
  if (!overview) {
    return (
      <div className="page-container animate-fade-in-up" style={{ maxWidth: 480, marginTop: 100 }}>
        <div className="alert alert-danger">
          <span>❌</span>
          <span>{error || "Could not load public data."}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container animate-fade-in-up">
      <div className="section-eyebrow">Public · No Sign-In Required</div>
      <h2 style={{ marginBottom: 4 }}>Placement Accountability Dashboard</h2>
      <p style={{ marginBottom: 32 }}>
        Every figure below is computed directly from immutable blockchain records —
        no college or company can selectively hide or inflate these numbers.
      </p>

      {error && (
        <div className="alert alert-danger" style={{ marginBottom: 24 }}>
          <span>❌</span><span>{error}</span>
        </div>
      )}

      {/* Overview */}
      <div className="grid-4 stagger-children animate-fade-in-up" style={{ marginBottom: 32 }}>
        <div className="stat-card">
          <div className="stat-label">Verified Colleges</div>
          <div className="stat-value">{overview.totalColleges}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Verified Companies</div>
          <div className="stat-value">{overview.totalCompanies}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Registered Students</div>
          <div className="stat-value">{overview.totalStudents}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Overall Placement %</div>
          <div className="stat-value">{overview.overallPlacementPercentage}%</div>
          <div className="stat-sub">{overview.totalPlaced} / {overview.totalStudents} placed</div>
        </div>
      </div>

      <div className="grid-2" style={{ gap: 28 }}>
        {/* Per-college leaderboard */}
        <div>
          <div className="section-eyebrow" style={{ marginBottom: 12 }}>
            Colleges ({colleges.length})
          </div>
          {colleges.length === 0 ? (
            <div className="empty-state glass-card">
              <div className="empty-state-icon">🏛️</div>
              <h3>No Verified Colleges Yet</h3>
              <p style={{ fontSize: "0.85rem" }}>Check back once colleges have been approved.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-10">
              {colleges.map((c) => (
                <div key={c.address} className="glass-card animate-fade-in-up" style={{ padding: "16px 20px" }}>
                  <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                    <strong style={{ fontFamily: "var(--font-head)" }}>{c.name}</strong>
                    <span className="badge badge-college">{c.percentage}%</span>
                  </div>
                  <div className="progress-bar-wrap">
                    <div className="progress-bar-fill" style={{ width: `${Math.min(c.percentage, 100)}%` }} />
                  </div>
                  <div className="flex items-center justify-between" style={{ marginTop: 6 }}>
                    <span className="mono-addr" style={{ fontSize: "0.7rem" }}>{shortAddr(c.address)}</span>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      {c.placed} / {c.registered} placed
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent activity feed */}
        <div>
          <div className="section-eyebrow" style={{ marginBottom: 12 }}>Recent Activity</div>
          {visits.length === 0 ? (
            <div className="empty-state glass-card">
              <div className="empty-state-icon">📅</div>
              <h3>No Activity Yet</h3>
              <p style={{ fontSize: "0.85rem" }}>Company visit announcements will appear here as colleges publish them.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-10">
              {visits.map((v) => (
                <div key={v.id} className="glass-card animate-fade-in-up" style={{ padding: "14px 18px" }}>
                  <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
                    <strong style={{ fontFamily: "var(--font-head)", fontSize: "0.9rem" }}>{v.companyName}</strong>
                    <span className="badge badge-company">{formatDate(v.visitDate)}</span>
                  </div>
                  <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                    Announced by {v.collegeName || shortAddr(v.collegeAddress)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
