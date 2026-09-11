/**
 * PublicDashboard.jsx — Public accountability dashboard
 *
 * No login required. This is the page that makes the platform's core promise
 * real: anyone can see placement stats calculated automatically from real,
 * recorded on-chain activity. Reads from the /public/* backend routes, which
 * are pure DB aggregation (see backend/src/routes/public.js) — cheap enough
 * for anonymous traffic.
 */

import React, { useState, useEffect, useCallback } from "react";
import { Landmark, Inbox, Calendar, AlertCircle, ArrowLeft, ArrowRight } from "lucide-react";
import { api } from "../utils/api.js";
import { shortAddr, formatDate, formatTimestamp as formatDateTime } from "../utils/format.js";

const SORTS = {
  rate: (a, b) => b.percentage - a.percentage,
  name: (a, b) => a.name.localeCompare(b.name),
  records: (a, b) => b.registered - a.registered,
};

export default function PublicDashboard() {
  const [overview, setOverview] = useState(null);
  const [colleges, setColleges] = useState([]);
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("rate");
  const [drilldown, setDrilldown] = useState(null); // { college: {address,name}, records, loading, error } | null

  const viewRecords = useCallback(async (college) => {
    setDrilldown({ college, records: [], loading: true, error: "" });
    try {
      const data = await api.get(`/public/colleges/${college.address}/records`);
      setDrilldown({ college, records: data.records, loading: false, error: "" });
    } catch (err) {
      setDrilldown({ college, records: [], loading: false, error: err.message || "Could not load records." });
    }
  }, []);

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
        <div className="alert alert-danger" role="alert">
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
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
        Every figure below is calculated automatically from verified on-chain activity,
        visible to everyone in real time.
      </p>

      {error && (
        <div className="alert alert-danger" role="alert" style={{ marginBottom: 24 }}>
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{error}</span>
        </div>
      )}

      {/* Overview */}
      <div className="kpi-strip">
        <div className="kpi">
          <span className="kpi-n">{overview.totalColleges}</span>
          <span className="kpi-l">Verified colleges</span>
        </div>
        <div className="kpi">
          <span className="kpi-n">{overview.totalCompanies}</span>
          <span className="kpi-l">Verified companies</span>
        </div>
        <div className="kpi">
          <span className="kpi-n">{overview.totalStudents}</span>
          <span className="kpi-l">Registered students</span>
        </div>
        <div className="kpi">
          <span className="kpi-n accent">{overview.overallPlacementPercentage}%</span>
          <span className="kpi-l">{overview.totalPlaced} / {overview.totalStudents} placed overall</span>
        </div>
      </div>

      <div className="grid-2" style={{ gap: 28, marginTop: 32 }}>
        {/* Per-college leaderboard */}
        <div>
          <div className="section-eyebrow" style={{ marginBottom: 12 }}>
            Colleges ({colleges.length})
          </div>
          {colleges.length === 0 ? (
            <div className="empty-state glass-card">
              <Landmark size={48} className="empty-state-icon" />
              <h3>No Verified Colleges Yet</h3>
              <p style={{ fontSize: "0.85rem" }}>Check back once colleges have been approved.</p>
            </div>
          ) : (
            <>
              <div className="board-toolbar">
                <input
                  type="text"
                  placeholder="Search colleges…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ width: 220 }}
                />
                <div className="board-sort">
                  <span>Sort by</span>
                  <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                    <option value="rate">Placement rate</option>
                    <option value="name">Name, A–Z</option>
                    <option value="records">Most registered</option>
                  </select>
                </div>
              </div>
              <div className="flex flex-col gap-10">
                {colleges
                  .filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()))
                  .sort(SORTS[sortBy])
                  .map((c) => (
                <div
                  key={c.address}
                  className="glass-card animate-fade-in-up"
                  style={{ padding: "16px 20px", cursor: "pointer", border: drilldown?.college.address === c.address ? "1px solid var(--accent-primary)" : undefined }}
                  role="button"
                  tabIndex={0}
                  onClick={() => viewRecords(c)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); viewRecords(c); } }}
                >
                  <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                    <strong style={{ fontFamily: "var(--font-head)" }}>{c.name}</strong>
                    <span className="badge badge-college">{c.percentage}%</span>
                  </div>
                  <div className="progress-bar-wrap">
                    <div className="progress-bar-fill" style={{ width: `${Math.min(c.percentage, 100)}%` }} />
                  </div>
                  <div className="flex items-center justify-between" style={{ marginTop: 6 }}>
                    <span
                      className="mono-addr"
                      style={{ fontSize: "0.7rem" }}
                      title={c.registrationNumber ? "Registration / accreditation ID" : c.address}
                    >
                      {c.registrationNumber || shortAddr(c.address)}
                    </span>
                    <span style={{ fontSize: "0.75rem", color: "var(--accent-primary)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {c.placed} / {c.registered} placed — view records <ArrowRight size={12} />
                    </span>
                  </div>
                </div>
              ))}
              </div>
            </>
          )}
        </div>

        {/* Recent activity feed, or a college's drill-down records */}
        <div>
          {drilldown ? (
            <>
              <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
                <div className="section-eyebrow" style={{ marginBottom: 0 }}>
                  Records for {drilldown.college.name}
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDrilldown(null)}>
                  <ArrowLeft size={14} /> Back to Activity
                </button>
              </div>
              <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: 12 }}>
                Every credential behind this college's percentage — issuer and type are shown;
                which student it belongs to is kept private.
              </p>
              {drilldown.loading ? (
                <div className="flex justify-center" style={{ padding: 24 }}>
                  <div className="spinner" />
                </div>
              ) : drilldown.error ? (
                <div className="alert alert-danger" role="alert">
                  <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>{drilldown.error}</span>
                </div>
              ) : drilldown.records.length === 0 ? (
                <div className="empty-state glass-card">
                  <Inbox size={48} className="empty-state-icon" />
                  <h3>No Records Yet</h3>
                  <p style={{ fontSize: "0.85rem" }}>Nothing has been issued to this college's students yet.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-10">
                  {drilldown.records.map((r) => (
                    <div key={r.id} className="glass-card animate-fade-in-up" style={{ padding: "14px 18px" }}>
                      <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
                        <span className="badge badge-college">{r.credType}</span>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{formatDateTime(r.timestamp)}</span>
                      </div>
                      <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                        Issued by {r.issuerName || shortAddr(r.issuerAddress)}
                        {r.issuerRole ? ` (${r.issuerRole})` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="section-eyebrow" style={{ marginBottom: 12 }}>Recent Activity</div>
              {visits.length === 0 ? (
                <div className="empty-state glass-card">
                  <Calendar size={48} className="empty-state-icon" />
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
