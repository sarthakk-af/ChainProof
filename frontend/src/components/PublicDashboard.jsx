/**
 * PublicDashboard.jsx — the page a parent reads.
 *
 * No login. The question it answers is specific: what happens when a company
 * comes to this college, and what are the odds. So it shows a funnel per drive
 * and a rate per cohort, with the denominator on display rather than assumed —
 * "92% placed" means nothing until you know 92% of what.
 *
 * No individual ever appears here. Accountability is owed by the institution,
 * not by the student who didn't get picked.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  Landmark,
  AlertCircle,
  Users,
  TrendingUp,
  Building2,
  GraduationCap,
  Megaphone,
  CalendarDays,
  Ban,
} from "lucide-react";
import { api } from "../utils/api.js";
import { formatDate } from "../utils/format.js";

function pct(n, d) {
  return d === 0 ? 0 : Math.round((n / d) * 1000) / 10;
}

export default function PublicDashboard() {
  const [colleges, setColleges] = useState([]);
  const [selected, setSelected] = useState(null);
  const [placement, setPlacement] = useState(null);
  const [drives, setDrives] = useState([]);
  const [recruiters, setRecruiters] = useState([]);
  const [preparation, setPreparation] = useState(null);
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/public/colleges")
      .then((d) => {
        setColleges(d.colleges);
        if (d.colleges.length > 0) setSelected(d.colleges[0].address);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const loadCollege = useCallback((address) => {
    if (!address) return;
    Promise.all([
      api.get(`/public/colleges/${address}/placement`),
      api.get(`/public/colleges/${address}/drives`),
      api.get(`/public/colleges/${address}/recruiters`),
      api.get(`/public/colleges/${address}/preparation`),
      api.get(`/public/colleges/${address}/announcements`),
    ])
      .then(([p, d, r, prep, ann]) => {
        setPlacement(p);
        setDrives(d.drives);
        setRecruiters(r.recruiters);
        setPreparation(prep);
        setNotices(ann.announcements);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => { loadCollege(selected); }, [selected, loadCollege]);

  if (loading) {
    return (
      <div className="page-container flex justify-center items-center" style={{ minHeight: 300 }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="page-container animate-fade-in-up">
      <div className="section-eyebrow">Public · No Sign-In Required</div>
      <h2 style={{ marginBottom: 4 }}>Placement, in the open</h2>
      <p style={{ marginBottom: 28, maxWidth: 680 }}>
        Every figure below was written by the party with nothing to gain from it — the
        company records who it selected, the student confirms they accepted, and the
        college's declared batch size is on the public record with each revision visible.
      </p>

      {error && (
        <div className="alert alert-danger" role="alert" style={{ marginBottom: 20 }}>
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{error}</span>
        </div>
      )}

      {colleges.length > 1 && (
        <div className="board-toolbar" style={{ marginBottom: 20, flexWrap: "wrap" }}>
          <div className="board-sort">
            <span>College</span>
            <select value={selected ?? ""} onChange={(e) => setSelected(e.target.value)}>
              {colleges.map((c) => <option key={c.address} value={c.address}>{c.name}</option>)}
            </select>
          </div>
        </div>
      )}

      {colleges.length === 0 ? (
        <div className="empty-state glass-card">
          <Landmark size={48} className="empty-state-icon" />
          <h3>Nothing published yet</h3>
          <p style={{ fontSize: "0.85rem" }}>Figures appear once a college publishes its cohorts.</p>
        </div>
      ) : (
        <>
          <Notices notices={notices} />
          <PlacementByBatch placement={placement} />
          <Preparation preparation={preparation} />
          <Recruiters recruiters={recruiters} />
          <Drives drives={drives} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * What the college did to prepare students.
 *
 * The other half of the story. Every other figure on this page holds the college
 * to account for results, and a poor year can always be blamed on a slow market —
 * until now there was nothing in the record to check that against. These entries
 * were written to the blockchain as the year went and cannot be topped up
 * afterwards, which is the only reason they are worth reading.
 */
function Preparation({ preparation }) {
  if (!preparation || preparation.events.length === 0) return null;
  const { summary, events } = preparation;

  return (
    <section style={{ marginBottom: 36 }}>
      <div className="section-eyebrow" style={{ marginBottom: 12 }}>
        How the college prepared students
      </div>

      <div className="glass-card p-24" style={{ marginBottom: 16 }}>
        <div className="flex gap-28" style={{ flexWrap: "wrap" }}>
          <div>
            <div style={{ fontFamily: "var(--font-head)", fontSize: "1.8rem" }}>{summary.standing}</div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Sessions held</div>
          </div>
          <div>
            <div style={{ fontFamily: "var(--font-head)", fontSize: "1.8rem" }}>{summary.attendances}</div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Total attendance</div>
          </div>
          {summary.cancelled > 0 && (
            <div>
              <div
                style={{ fontFamily: "var(--font-head)", fontSize: "1.8rem", color: "var(--text-muted)" }}
              >
                {summary.cancelled}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Called off</div>
            </div>
          )}
        </div>

        {summary.byKind.length > 0 && (
          <div className="flex gap-8" style={{ flexWrap: "wrap", marginTop: 16 }}>
            {summary.byKind
              .filter((k) => k.standing > 0)
              .map((k) => (
                <span key={k.kind} className="pill" style={{ fontSize: "0.72rem" }}>
                  {k.kind} · {k.standing}
                </span>
              ))}
          </div>
        )}

        <p style={{ fontSize: "0.76rem", color: "var(--text-muted)", marginTop: 14 }}>
          Attendance is counted per session, so a student attending three sessions counts
          three times. Sessions the college later said did not happen stay on the record
          and stop counting.
        </p>
      </div>

      <div className="flex flex-col gap-10">
        {events.slice(0, 12).map((e) => (
          <div
            key={e.id}
            className="glass-card"
            style={{ padding: "14px 20px", opacity: e.cancelled ? 0.65 : 1 }}
          >
            <div className="flex items-center justify-between gap-12" style={{ flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div className="flex items-center gap-8" style={{ flexWrap: "wrap" }}>
                  <GraduationCap size={14} style={{ flexShrink: 0 }} />
                  <strong style={{ fontSize: "0.9rem" }}>{e.title}</strong>
                  <span className="pill pill-muted" style={{ fontSize: "0.66rem" }}>{e.kind}</span>
                  {e.cancelled && (
                    <span className="pill" style={{ fontSize: "0.66rem" }}>
                      <Ban size={10} /> Did not happen
                    </span>
                  )}
                </div>
                <div style={{ fontSize: "0.76rem", color: "var(--text-muted)", marginTop: 4 }}>
                  <CalendarDays size={11} style={{ verticalAlign: "-1px" }} /> {formatDate(e.heldOn)} ·{" "}
                  {e.attendance} attended · by {e.conductedBy}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Notices the college addressed to everyone.
 *
 * Marked as what they are: announcements, which can be edited and withdrawn,
 * unlike every other figure on this page. Saying so is the difference between a
 * page that can be trusted and one that merely looks official.
 */
function Notices({ notices }) {
  if (!notices || notices.length === 0) return null;

  return (
    <section style={{ marginBottom: 36 }}>
      <div className="section-eyebrow" style={{ marginBottom: 12 }}>From the placement cell</div>
      <div className="flex flex-col gap-10">
        {notices.slice(0, 5).map((n) => (
          <div key={n.id} className="glass-card" style={{ padding: "16px 20px" }}>
            <div className="flex items-center gap-8" style={{ marginBottom: 6 }}>
              <Megaphone size={14} style={{ flexShrink: 0 }} />
              <strong style={{ fontSize: "0.92rem" }}>{n.title}</strong>
            </div>
            <p style={{ fontSize: "0.85rem", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{n.body}</p>
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 8 }}>
              {n.authorName} · {formatDate(Math.floor(n.createdAt / 1000))}
              {n.editedAt && " · edited"}
            </div>
          </div>
        ))}
      </div>
      <p style={{ fontSize: "0.74rem", color: "var(--text-muted)", marginTop: 10 }}>
        Notices are announcements — they can be edited or withdrawn. The drives, sessions
        and results elsewhere on this page are on the blockchain and cannot be.
      </p>
    </section>
  );
}

function PlacementByBatch({ placement }) {
  if (!placement) return null;
  if (placement.batches.length === 0) {
    return (
      <div className="empty-state glass-card" style={{ marginBottom: 32 }}>
        <TrendingUp size={48} className="empty-state-icon" />
        <h3>No cohorts published</h3>
        <p style={{ fontSize: "0.85rem" }}>
          A placement rate needs a batch size to divide by, and this college hasn't
          declared one yet.
        </p>
      </div>
    );
  }

  return (
    <section style={{ marginBottom: 36 }}>
      <div className="section-eyebrow" style={{ marginBottom: 12 }}>Placement by batch</div>
      <div className="flex flex-col gap-10">
        {placement.batches.map((b) => (
          <div key={b.batchYear} className="glass-card" style={{ padding: "16px 20px" }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
              <strong style={{ fontFamily: "var(--font-head)" }}>Batch {b.batchYear}</strong>
              <span className="badge badge-college">{b.placementRateOfBatch}% of the batch</span>
            </div>

            <div className="progress-bar-wrap">
              <div className="progress-bar-fill" style={{ width: `${Math.min(b.placementRateOfBatch, 100)}%` }} />
            </div>

            {/* Both denominators, side by side. A rate quoted against the students
                who signed up rather than the whole batch is the usual way a
                placement figure flatters itself. */}
            <div className="grid-2" style={{ gap: 12, marginTop: 14, fontSize: "0.8rem" }}>
              <div>
                <div style={{ color: "var(--text-muted)" }}>Of the declared batch</div>
                <div><strong>{b.placed} of {b.declaredStrength}</strong> — {b.placementRateOfBatch}%</div>
              </div>
              <div>
                <div style={{ color: "var(--text-muted)" }}>Of students who signed up</div>
                <div><strong>{b.placed} of {b.registered}</strong> — {b.placementRateOfRegistered}%</div>
              </div>
            </div>

            {b.declaredStrengthRevisions > 0 && (
              <div className="alert alert-warning" style={{ fontSize: "0.78rem", marginTop: 12 }}>
                <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>
                  This college has revised the declared size of this batch{" "}
                  {b.declaredStrengthRevisions} time{b.declaredStrengthRevisions === 1 ? "" : "s"}.
                  Every revision is on the public record.
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function Recruiters({ recruiters }) {
  if (recruiters.length === 0) return null;
  return (
    <section style={{ marginBottom: 36 }}>
      <div className="section-eyebrow" style={{ marginBottom: 12 }}>
        Who recruits here ({recruiters.length})
      </div>
      <div className="flex flex-col gap-8">
        {recruiters.map((r) => (
          <div key={r.companyName} className="glass-card flex items-center justify-between" style={{ padding: "12px 18px", flexWrap: "wrap", gap: 8 }}>
            <span className="flex items-center gap-8">
              <Building2 size={15} style={{ color: "var(--accent-primary)" }} />
              <strong style={{ fontFamily: "var(--font-head)", fontSize: "0.9rem" }}>{r.companyName}</strong>
            </span>
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
              {r.driveCount} drive{r.driveCount === 1 ? "" : "s"} · up to ₹{r.highestPackage.toLocaleString("en-IN")}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function Drives({ drives }) {
  if (drives.length === 0) {
    return (
      <div className="empty-state glass-card">
        <Users size={48} className="empty-state-icon" />
        <h3>No drives yet</h3>
        <p style={{ fontSize: "0.85rem" }}>Drives appear here once a company has run one.</p>
      </div>
    );
  }

  return (
    <section>
      <div className="section-eyebrow" style={{ marginBottom: 12 }}>Every drive ({drives.length})</div>
      <div className="flex flex-col gap-10">
        {drives.map((d) => <DriveFunnel key={d.id} drive={d} />)}
      </div>
    </section>
  );
}

function DriveFunnel({ drive }) {
  const f = drive.funnel;
  // "Applied" is the company's own signed figure. Null means it hasn't published
  // one, which is a different fact from nobody applying — so say so rather than
  // showing a zero that isn't true.
  const steps = [
    { label: "Applied", value: f.applied, unpublished: f.applied === null },
    { label: "Shortlisted", value: f.shortlisted },
    { label: "Assessed", value: f.assessed },
    { label: "Interviewed", value: f.interviewed },
    { label: "Offered", value: f.offered },
    { label: "Accepted", value: f.accepted },
  ].filter((s) => s.unpublished || s.value > 0);

  const widest = Math.max(1, ...steps.map((s) => s.value ?? 0));

  return (
    <div className="glass-card" style={{ padding: "16px 20px" }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 4, flexWrap: "wrap", gap: 8 }}>
        <strong style={{ fontFamily: "var(--font-head)" }}>{drive.companyName} — {drive.roleTitle}</strong>
        <span className="badge badge-company">₹{drive.annualPackage.toLocaleString("en-IN")}</span>
      </div>
      <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: 14 }}>
        {formatDate(drive.driveDate)} · batch {drive.batchYear}
        {drive.minCgpa ? ` · CGPA ${drive.minCgpa.toFixed(2)}+` : ""}
        {drive.status === "Cancelled" && <span style={{ color: "var(--accent-warning)" }}> · cancelled</span>}
      </div>

      <div className="flex flex-col gap-8">
        {steps.map((s) => (
          <div key={s.label}>
            <div className="flex items-center justify-between" style={{ fontSize: "0.78rem", marginBottom: 3 }}>
              <span>{s.label}</span>
              <span style={{ color: "var(--text-muted)" }}>
                {s.unpublished ? "not published" : s.value}
              </span>
            </div>
            <div className="progress-bar-wrap">
              <div
                className="progress-bar-fill"
                style={{
                  width: s.unpublished ? "0%" : `${pct(s.value, widest)}%`,
                  opacity: s.unpublished ? 0.3 : 1,
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {f.applied === null && (
        <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 10 }}>
          The applicant total is published by the company, not by the college — this one
          hasn't confirmed it yet.
        </p>
      )}
    </div>
  );
}
