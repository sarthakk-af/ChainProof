/**
 * CollegeDashboard.jsx — the placement cell's console.
 *
 * In v2 the college account is also the administrator, so everything the old
 * separate admin panel did lives here. What it deliberately cannot do is write
 * anything that belongs to someone else: it admits companies, agrees to host
 * drives, lists its own students and declares cohort sizes. It never authors an
 * offer, a package, or an outcome.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  Users,
  Building2,
  CalendarDays,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Upload,
  TrendingUp,
  UserCheck,
  GraduationCap,
  Megaphone,
  Clock,
} from "lucide-react";
import PreparationPanel from "./college/PreparationPanel.jsx";
import Announcements from "./shared/Announcements.jsx";
import Tabs, { useUrlTab } from "./shared/Tabs.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../utils/api.js";
import { shortAddr, formatDate, formatLPA } from "../utils/format.js";

/** True while either button for `id` is working (busy is "<id>:<action>"). */
const isBusy = (busy, id) => typeof busy === "string" && busy.startsWith(`${id}:`);

const TABS = [
  { id: "students", label: "Students", icon: UserCheck },
  { id: "companies", label: "Companies", icon: Building2 },
  { id: "drives", label: "Drives", icon: CalendarDays },
  { id: "roster", label: "Roster", icon: Users },
  { id: "batches", label: "Cohorts", icon: TrendingUp },
  { id: "preparation", label: "Preparation", icon: GraduationCap },
  { id: "notices", label: "Notices", icon: Megaphone },
];

export default function CollegeDashboard() {
  const { actor } = useAuth();
  const [tab, setTab] = useUrlTab(TABS.map((t) => t.id), "students");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  return (
    <div className="page-container animate-fade-in-up">
      <header className="page-head">
        <div className="section-eyebrow">Placement cell</div>
        <h2>{actor?.name}</h2>
        <p>
          Admit companies and host their drives. Offers and results are written by the
          companies themselves.
        </p>
      </header>

      <Tabs
        tabs={TABS}
        value={tab}
        onChange={(id) => { setTab(id); setError(""); setNotice(""); }}
        label="Placement cell sections"
      />

      {error && (
        <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}>
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="alert alert-info" role="status" style={{ marginBottom: 16 }}>
          <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{notice}</span>
        </div>
      )}

      {tab === "students" && <VerificationsPanel onError={setError} onNotice={setNotice} />}
      {tab === "companies" && <CompaniesPanel onError={setError} onNotice={setNotice} />}
      {tab === "drives" && <DrivesPanel onError={setError} onNotice={setNotice} />}
      {tab === "roster" && <RosterPanel onError={setError} onNotice={setNotice} />}
      {tab === "batches" && <BatchesPanel onError={setError} onNotice={setNotice} />}
      {tab === "preparation" && <PreparationPanel onError={setError} onNotice={setNotice} />}
      {tab === "notices" && <Announcements role="College" />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function CompaniesPanel({ onError, onNotice }) {
  const [companies, setCompanies] = useState([]);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    api.get("/college/companies").then((d) => setCompanies(d.companies)).catch((e) => onError(e.message));
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const decide = async (address, action) => {
    setBusy(`${address}:${action}`);
    onError("");
    try {
      await api.post(`/college/companies/${address}/${action}`, {});
      onNotice(action === "approve" ? "Company admitted." : "Company declined.");
      load();
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const pending = companies.filter((c) => c.status === "Pending");
  const active = companies.filter((c) => c.status === "Active");

  return (
    <div className="split-even">
      <section>
        <div className="section-head">
          <div className="section-eyebrow">Awaiting your decision ({pending.length})</div>
        </div>
        <div className="row-list">
          {pending.length === 0 && (
            <div className="row-empty">Nothing waiting. Companies appear here once they register.</div>
          )}
          {pending.map((c) => (
            <div key={c.address} className="row">
              <div style={{ minWidth: 0 }}>
                <strong className="item-title">{c.name}</strong>
                <div className="row-meta" style={{ marginTop: 2 }}>
                  CIN <span className="mono-addr">{c.registrationNumber || "—"}</span>
                  {c.website && (
                    <>
                      {" · "}
                      <a href={c.website} target="_blank" rel="noreferrer noopener">{c.website.replace(/^https?:\/\//, "")}</a>
                      {c.websiteReachable === false && (
                        <span style={{ color: "var(--accent-warning)" }}> (didn't respond)</span>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="flex gap-8">
                <button className="btn btn-primary btn-sm" disabled={isBusy(busy, c.address)} onClick={() => decide(c.address, "approve")}>
                  {busy === `${c.address}:approve` ? <span className="spinner" /> : <><CheckCircle2 size={14} /> Admit</>}
                </button>
                <button className="btn btn-ghost btn-sm" disabled={isBusy(busy, c.address)} onClick={() => decide(c.address, "reject")}>
                  {busy === `${c.address}:reject` ? <span className="spinner" /> : <><XCircle size={14} /> Decline</>}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="section-head">
          <div className="section-eyebrow">Admitted ({active.length})</div>
        </div>
        <div className="row-list">
          {active.length === 0 && <div className="row-empty">No companies admitted yet.</div>}
          {active.map((c) => (
            <div key={c.address} className="row">
              <strong className="item-title">{c.name}</strong>
              <span className="mono-addr" style={{ fontSize: "0.72rem" }}>{c.registrationNumber || shortAddr(c.address)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

function DrivesPanel({ onError, onNotice }) {
  const [drives, setDrives] = useState([]);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    api.get("/college/drives").then((d) => setDrives(d.drives)).catch((e) => onError(e.message));
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const decide = async (id, action) => {
    setBusy(`${id}:${action}`);
    onError("");
    try {
      await api.post(`/college/drives/${id}/${action}`, {});
      onNotice(action === "approve" ? "Drive approved — students can see it now." : "Drive declined.");
      load();
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const proposed = drives.filter((d) => d.status === "Proposed");
  const rest = drives.filter((d) => d.status !== "Proposed");

  return (
    <div className="split-even">
      <section>
        <div className="section-head">
          <div className="section-eyebrow">Proposed ({proposed.length})</div>
        </div>
        <p className="form-hint" style={{ margin: "0 0 10px" }}>
          The company set these terms. You decide only whether the drive runs on your campus.
        </p>
        <div className="row-list">
          {proposed.length === 0 && (
            <div className="row-empty">No drives waiting. Companies post openings; you decide whether they run here.</div>
          )}
          {proposed.map((d) => (
            <div key={d.id} className="row">
              <div style={{ minWidth: 0 }}>
                <div className="flex items-center gap-8" style={{ flexWrap: "wrap" }}>
                  <strong className="item-title">{d.companyName} — {d.roleTitle}</strong>
                  <span className="pill">{formatLPA(d.annualPackage)}</span>
                </div>
                <div className="row-meta" style={{ marginTop: 2 }}>
                  Batch {d.batchYear}
                  {d.minCgpa ? ` · CGPA ${d.minCgpa.toFixed(2)}+` : " · no CGPA cutoff"}
                  {" · "}drive {formatDate(d.driveDate)}
                </div>
              </div>
              <div className="flex gap-8">
                <button className="btn btn-primary btn-sm" disabled={isBusy(busy, d.id)} onClick={() => decide(d.id, "approve")}>
                  {busy === `${d.id}:approve` ? <span className="spinner" /> : <><CheckCircle2 size={14} /> Host it</>}
                </button>
                <button className="btn btn-ghost btn-sm" disabled={isBusy(busy, d.id)} onClick={() => decide(d.id, "reject")}>
                  {busy === `${d.id}:reject` ? <span className="spinner" /> : <><XCircle size={14} /> Decline</>}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="section-head">
          <div className="section-eyebrow">All drives ({rest.length})</div>
        </div>
        <div className="row-list">
          {rest.length === 0 && <div className="row-empty">No drives decided yet.</div>}
          {rest.map((d) => (
            <div key={d.id} className="row">
              <span style={{ fontSize: "0.86rem" }}>{d.companyName} — {d.roleTitle}</span>
              <span className="badge badge-student">{d.status}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

function RosterPanel({ onError, onNotice }) {
  const [roster, setRoster] = useState([]);
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [rowErrors, setRowErrors] = useState([]);

  const load = useCallback(() => {
    api.get("/college/roster")
      .then((d) => setRoster(d.roster))
      .catch((e) => onError(e.message));
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const upload = async () => {
    if (busy) return;
    setBusy(true);
    onError("");
    setRowErrors([]);

    // One student per line: roll, name, course, batch year.
    const entries = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [rollNumber, fullName, courseCode, batchYear] = line.split(",").map((p) => (p ?? "").trim());
        return { rollNumber, fullName, courseCode, batchYear };
      });

    try {
      const result = await api.post("/college/roster", { entries });
      onNotice(
        `${result.added} added, ${result.updated} updated` +
          (result.skippedClaimed.length ? `, ${result.skippedClaimed.length} left alone (already claimed)` : "")
      );
      setRaw("");
      load();
    } catch (e) {
      onError(e.message);
      if (Array.isArray(e.errors)) setRowErrors(e.errors);
    } finally {
      setBusy(false);
    }
  };

  const claimed = roster.filter((r) => r.claimed).length;
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const shown = needle
    ? roster.filter((r) => `${r.rollNumber} ${r.fullName}`.toLowerCase().includes(needle))
    : roster;

  return (
    <div className="split">
      <div className="glass-card p-24 flex flex-col gap-12">
        <div>
          <h3 className="card-title">Upload your roster</h3>
          <p className="card-lead">
            One student per line. Students can only sign up with a roll number on this list.
          </p>
        </div>
        <label htmlFor="roster-raw" style={{ marginBottom: -6 }}>
          Roll number, full name, course, batch year
        </label>
        <textarea
          id="roster-raw"
          className="textarea-mono"
          rows={7}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={"21CE1042, Asha Patil, CSE, 2026\n21CE1043, Rahul Nair, CSE, 2026"}
        />
        {rowErrors.length > 0 && (
          <div className="alert alert-danger" role="alert">
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              {rowErrors.slice(0, 5).map((e) => (
                <div key={e.row}>Row {e.row}: {e.error}</div>
              ))}
              {rowErrors.length > 5 && <div>…and {rowErrors.length - 5} more.</div>}
            </span>
          </div>
        )}
        <button className="btn btn-primary" onClick={upload} disabled={busy || !raw.trim()}>
          {busy ? <span className="spinner" /> : <><Upload size={16} /> Upload roster</>}
        </button>
      </div>

      <section>
        <div className="section-head">
          <div className="section-eyebrow">
            Roster · {roster.length} students · {claimed} signed up
          </div>
          <input
            aria-label="Search the roster"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search roll number or name"
            style={{ maxWidth: 260 }}
          />
        </div>
        <div className="row-list">
          {roster.length === 0 && <div className="row-empty">No students uploaded yet.</div>}
          {roster.length > 0 && shown.length === 0 && <div className="row-empty">No one matches “{search}”.</div>}
          {shown.slice(0, 100).map((r) => (
            <div key={r.rollNumber} className="row" style={{ padding: "8px 16px" }}>
              <span style={{ fontSize: "0.85rem" }}>
                <span className="mono-addr">{r.rollNumber}</span> {r.fullName}
              </span>
              <span className="row-meta">
                {r.courseCode} {r.batchYear} ·{" "}
                <span style={r.claimed ? { color: "var(--accent-success)" } : undefined}>
                  {r.claimed ? "signed up" : "not yet"}
                </span>
              </span>
            </div>
          ))}
          {shown.length > 100 && (
            <div className="row-empty">Showing 100 of {shown.length}. Search to find someone.</div>
          )}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

function BatchesPanel({ onError, onNotice }) {
  const [batches, setBatches] = useState([]);
  const [courseCode, setCourseCode] = useState("");
  const [batchYear, setBatchYear] = useState("");
  const [strength, setStrength] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get("/college/batches").then((d) => setBatches(d.batches)).catch((e) => onError(e.message));
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    onError("");
    try {
      await api.post("/college/batches", {
        courseCode: courseCode.trim().toUpperCase(),
        batchYear: Number(batchYear),
        strength: Number(strength),
      });
      onNotice("Cohort size recorded on-chain.");
      setCourseCode(""); setBatchYear(""); setStrength("");
      load();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="split">
      <form onSubmit={submit} className="glass-card p-24 flex flex-col gap-12">
        <div>
          <h3 className="card-title">Declare a cohort's size</h3>
          <p className="card-lead">
            The denominator of your placement percentage. You can revise it, but the earlier
            figure stays visible.
          </p>
        </div>
        <div className="form-grid cols-2">
          <div className="form-group">
            <label htmlFor="b-course">Course</label>
            <input id="b-course" value={courseCode} onChange={(e) => setCourseCode(e.target.value.toUpperCase())} placeholder="CSE" required />
          </div>
          <div className="form-group">
            <label htmlFor="b-year">Batch year</label>
            <input id="b-year" type="number" value={batchYear} onChange={(e) => setBatchYear(e.target.value)} placeholder="2026" required />
          </div>
          <div className="form-group span-all">
            <label htmlFor="b-strength">Total students</label>
            <input id="b-strength" type="number" value={strength} onChange={(e) => setStrength(e.target.value)} placeholder="180" required />
          </div>
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? <span className="spinner" /> : "Record on-chain"}
        </button>
      </form>

      <section>
        <div className="section-head">
          <div className="section-eyebrow">Declared cohorts ({batches.length})</div>
        </div>
        <div className="row-list">
          {batches.length === 0 && <div className="row-empty">No cohorts declared yet.</div>}
          {batches.map((b) => (
            <div key={`${b.courseCode}-${b.batchYear}`} className="row">
              <div>
                <strong className="item-title">{b.courseCode} {b.batchYear}</strong>
                {b.revisionCount > 0 && (
                  <div className="row-meta" style={{ color: "var(--accent-warning)" }}>
                    Revised {b.revisionCount} time{b.revisionCount === 1 ? "" : "s"} · previously {b.previousStrength}
                  </div>
                )}
              </div>
              <span className="badge badge-college">{b.strength} students</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Students whose roll number wasn't on the roster when they signed up.
 *
 * This queue is what makes the ordering not matter. A student who arrives
 * before the roster does waits here instead of being turned away, and
 * approving them adds them to the roster — so the roster stays the single
 * record of who belongs here rather than approval becoming a quieter second
 * way in.
 */
function VerificationsPanel({ onError, onNotice }) {
  const [pending, setPending] = useState([]);
  const [details, setDetails] = useState({});
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    api.get("/college/verifications")
      .then((d) => setPending(d.pending))
      .catch((e) => onError(e.message));
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const setField = (userId, key) => (e) =>
    setDetails((d) => ({ ...d, [userId]: { ...(d[userId] ?? {}), [key]: e.target.value } }));

  const approve = async (userId) => {
    const entry = details[userId] ?? {};
    if (!entry.fullName || !entry.courseCode || !entry.batchYear) {
      onError("Fill in the name, course and batch year before approving.");
      return;
    }
    setBusy(`${userId}:approve`);
    onError("");
    try {
      await api.post(`/college/verifications/${userId}/approve`, {
        fullName: entry.fullName,
        courseCode: entry.courseCode,
        batchYear: Number(entry.batchYear),
      });
      onNotice("Student confirmed and added to the roster.");
      load();
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const reject = async (userId) => {
    setBusy(`${userId}:reject`);
    onError("");
    try {
      await api.post(`/college/verifications/${userId}/reject`, {
        reason: details[userId]?.reason ?? "",
      });
      onNotice("Request declined.");
      load();
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (pending.length === 0) {
    return (
      <div className="empty-state glass-card">
        <UserCheck className="empty-state-icon" />
        <h3>Nobody waiting</h3>
        <p style={{ fontSize: "0.85rem" }}>
          Students whose roll number is already on your roster are confirmed
          automatically. Anyone the roster doesn't cover appears here.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="section-head">
        <div className="section-eyebrow">Waiting for you ({pending.length})</div>
      </div>
      <p className="form-hint" style={{ margin: "0 0 10px" }}>
        These roll numbers aren't on your roster yet. Confirming a student adds them to it.
      </p>

      <div className="row-list">
        {pending.map((p) => (
          <div key={p.userId} className="row" style={{ display: "block" }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
              <div>
                <strong className="mono-addr">
                  {p.rollNumber}
                </strong>
                <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{p.email}</div>
              </div>
              <span className="badge badge-student">
                <Clock size={12} /> Waiting
              </span>
            </div>

            <div className="form-grid cols-wide-first" style={{ marginBottom: 10 }}>
              <div className="form-group">
                <label htmlFor={`v-name-${p.userId}`}>Full name</label>
                <input
                  id={`v-name-${p.userId}`}
                  value={details[p.userId]?.fullName ?? ""}
                  onChange={setField(p.userId, "fullName")}
                  placeholder="As on college records"
                />
              </div>
              <div className="form-group">
                <label htmlFor={`v-course-${p.userId}`}>Course</label>
                <input
                  id={`v-course-${p.userId}`}
                  value={details[p.userId]?.courseCode ?? ""}
                  onChange={setField(p.userId, "courseCode")}
                  placeholder="CSE"
                />
              </div>
              <div className="form-group">
                <label htmlFor={`v-batch-${p.userId}`}>Batch year</label>
                <input
                  id={`v-batch-${p.userId}`}
                  type="number"
                  value={details[p.userId]?.batchYear ?? ""}
                  onChange={setField(p.userId, "batchYear")}
                  placeholder="2026"
                />
              </div>
            </div>

            <div className="flex gap-8" style={{ flexWrap: "wrap" }}>
              <button
                className="btn btn-primary btn-sm"
                disabled={isBusy(busy, p.userId)}
                onClick={() => approve(p.userId)}
              >
                {busy === `${p.userId}:approve` ? <span className="spinner" /> : <><CheckCircle2 size={14} /> Confirm</>}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                disabled={isBusy(busy, p.userId)}
                onClick={() => reject(p.userId)}
              >
                {busy === `${p.userId}:reject` ? <span className="spinner" /> : <><XCircle size={14} /> Decline</>}
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
