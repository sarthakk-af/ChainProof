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
import { shortAddr, formatDate } from "../utils/format.js";

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
      <div className="section-eyebrow">Placement Cell</div>
      <h2 style={{ marginBottom: 4 }}>{actor?.name}</h2>
      <p style={{ marginBottom: 24, fontSize: "0.85rem", color: "var(--text-muted)" }}>
        Admit companies and host their drives. Offers and results are written by the
        companies themselves.
      </p>

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
    setBusy(address);
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
    <>
      <div className="section-eyebrow" style={{ marginBottom: 12 }}>
        Awaiting your decision ({pending.length})
      </div>
      {pending.length === 0 ? (
        <div className="empty-state glass-card">
          <Building2 size={48} className="empty-state-icon" />
          <h3>Nothing waiting</h3>
          <p style={{ fontSize: "0.85rem" }}>Companies appear here once they register.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-10">
          {pending.map((c) => (
            <div key={c.address} className="glass-card" style={{ padding: "16px 20px" }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                <strong style={{ fontFamily: "var(--font-head)" }}>{c.name}</strong>
                <span className="badge badge-company">Pending</span>
              </div>
              <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: 12 }}>
                <div>CIN: <span className="mono-addr">{c.registrationNumber || "—"}</span></div>
                {c.website && (
                  <div>
                    Website: <a href={c.website} target="_blank" rel="noreferrer noopener">{c.website}</a>
                    {c.websiteReachable === false && (
                      <span style={{ color: "var(--accent-warning)" }}> · didn't respond</span>
                    )}
                  </div>
                )}
                <div>Wallet: <span className="mono-addr">{shortAddr(c.address)}</span></div>
              </div>
              <div className="flex gap-8" style={{ flexWrap: "wrap" }}>
                <button className="btn btn-primary btn-sm" disabled={busy === c.address} onClick={() => decide(c.address, "approve")}>
                  <CheckCircle2 size={14} /> Admit
                </button>
                <button className="btn btn-ghost btn-sm" disabled={busy === c.address} onClick={() => decide(c.address, "reject")}>
                  <XCircle size={14} /> Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="section-eyebrow" style={{ margin: "28px 0 12px" }}>
        Admitted ({active.length})
      </div>
      <div className="flex flex-col gap-8">
        {active.map((c) => (
          <div key={c.address} className="glass-card flex items-center justify-between" style={{ padding: "12px 18px", flexWrap: "wrap", gap: 8 }}>
            <strong style={{ fontFamily: "var(--font-head)", fontSize: "0.9rem" }}>{c.name}</strong>
            <span className="mono-addr" style={{ fontSize: "0.72rem" }}>{c.registrationNumber || shortAddr(c.address)}</span>
          </div>
        ))}
      </div>
    </>
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
    setBusy(id);
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
    <>
      <div className="section-eyebrow" style={{ marginBottom: 12 }}>
        Proposed ({proposed.length})
      </div>
      {proposed.length === 0 ? (
        <div className="empty-state glass-card">
          <CalendarDays size={48} className="empty-state-icon" />
          <h3>No drives waiting</h3>
          <p style={{ fontSize: "0.85rem" }}>Companies post openings; you decide whether they run here.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-10">
          {proposed.map((d) => (
            <div key={d.id} className="glass-card" style={{ padding: "16px 20px" }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
                <strong style={{ fontFamily: "var(--font-head)" }}>{d.companyName} — {d.roleTitle}</strong>
                <span className="badge badge-company">₹{d.annualPackage.toLocaleString("en-IN")}</span>
              </div>
              <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: 12 }}>
                Batch {d.batchYear}
                {d.minCgpa ? ` · CGPA ${d.minCgpa.toFixed(2)}+` : " · no CGPA cutoff"}
                {" · "}drive {formatDate(d.driveDate)}
              </div>
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 12 }}>
                These terms were set by the company and can't be edited here — you're
                deciding only whether the drive runs on your campus.
              </p>
              <div className="flex gap-8" style={{ flexWrap: "wrap" }}>
                <button className="btn btn-primary btn-sm" disabled={busy === d.id} onClick={() => decide(d.id, "approve")}>
                  <CheckCircle2 size={14} /> Host it
                </button>
                <button className="btn btn-ghost btn-sm" disabled={busy === d.id} onClick={() => decide(d.id, "reject")}>
                  <XCircle size={14} /> Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="section-eyebrow" style={{ margin: "28px 0 12px" }}>All drives ({rest.length})</div>
      <div className="flex flex-col gap-8">
        {rest.map((d) => (
          <div key={d.id} className="glass-card flex items-center justify-between" style={{ padding: "12px 18px", flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: "0.88rem" }}>{d.companyName} — {d.roleTitle}</span>
            <span className="badge badge-student">{d.status}</span>
          </div>
        ))}
      </div>
    </>
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

  return (
    <>
      <div className="glass-card p-24 flex flex-col gap-16" style={{ marginBottom: 24 }}>
        <div>
          <strong style={{ fontFamily: "var(--font-head)" }}>Upload your roster</strong>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>
            One student per line: <code>roll number, full name, course, batch year</code>.
            This list is what lets a student prove they study here — nobody can sign up
            with a roll number that isn't on it.
          </p>
        </div>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={"21CE1042, Asha Patil, CSE, 2026\n21CE1043, Rahul Nair, CSE, 2026"}
          style={{ height: 160, fontFamily: "var(--font-mono)", fontSize: "0.78rem" }}
        />
        {rowErrors.length > 0 && (
          <div className="alert alert-danger" style={{ fontSize: "0.78rem" }}>
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

      <div className="kpi-strip" style={{ marginBottom: 20 }}>
        <div className="kpi">
          <span className="kpi-n">{roster.length}</span>
          <span className="kpi-l">On the roster</span>
        </div>
        <div className="kpi">
          <span className="kpi-n accent">{claimed}</span>
          <span className="kpi-l">Signed up</span>
        </div>
      </div>

      <div className="flex flex-col gap-8">
        {roster.slice(0, 100).map((r) => (
          <div key={r.rollNumber} className="glass-card flex items-center justify-between" style={{ padding: "10px 16px", flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: "0.85rem" }}>
              <span className="mono-addr">{r.rollNumber}</span> · {r.fullName}
            </span>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {r.courseCode} {r.batchYear} · {r.claimed ? "signed up" : "not yet"}
            </span>
          </div>
        ))}
        {roster.length > 100 && (
          <p style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
            Showing the first 100 of {roster.length}.
          </p>
        )}
      </div>
    </>
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
    <>
      <form onSubmit={submit} className="glass-card p-24 flex flex-col gap-16" style={{ marginBottom: 24 }}>
        <div>
          <strong style={{ fontFamily: "var(--font-head)" }}>Declare a cohort's size</strong>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>
            This is the denominator of your placement percentage, so it goes on-chain.
            You can revise it later — but the previous figure stays visible, which is
            what makes the number worth quoting.
          </p>
        </div>
        <div className="grid-2" style={{ gap: 12 }}>
          <div className="form-group">
            <label htmlFor="b-course">Course</label>
            <input id="b-course" value={courseCode} onChange={(e) => setCourseCode(e.target.value.toUpperCase())} placeholder="CSE" required />
          </div>
          <div className="form-group">
            <label htmlFor="b-year">Batch year</label>
            <input id="b-year" type="number" value={batchYear} onChange={(e) => setBatchYear(e.target.value)} placeholder="2026" required />
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="b-strength">Total students</label>
          <input id="b-strength" type="number" value={strength} onChange={(e) => setStrength(e.target.value)} placeholder="180" required />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? <span className="spinner" /> : "Record on-chain"}
        </button>
      </form>

      <div className="flex flex-col gap-8">
        {batches.map((b) => (
          <div key={`${b.courseCode}-${b.batchYear}`} className="glass-card" style={{ padding: "12px 18px" }}>
            <div className="flex items-center justify-between" style={{ flexWrap: "wrap", gap: 8 }}>
              <strong style={{ fontFamily: "var(--font-head)", fontSize: "0.9rem" }}>
                {b.courseCode} {b.batchYear}
              </strong>
              <span className="badge badge-college">{b.strength} students</span>
            </div>
            {b.revisionCount > 0 && (
              <div style={{ fontSize: "0.75rem", color: "var(--accent-warning)", marginTop: 4 }}>
                Revised {b.revisionCount} time{b.revisionCount === 1 ? "" : "s"} · previously {b.previousStrength}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
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
    setBusy(userId);
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
    setBusy(userId);
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
        <UserCheck size={48} className="empty-state-icon" />
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
      <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: 16 }}>
        These students gave a roll number your roster doesn't list yet. Confirming one
        adds them to the roster, so your list stays the single record of who studies here.
      </p>

      <div className="flex flex-col gap-10">
        {pending.map((p) => (
          <div key={p.userId} className="glass-card" style={{ padding: "16px 20px" }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
              <div>
                <strong style={{ fontFamily: "var(--font-head)" }} className="mono-addr">
                  {p.rollNumber}
                </strong>
                <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{p.email}</div>
              </div>
              <span className="badge badge-student">
                <Clock size={12} /> Waiting
              </span>
            </div>

            <div className="grid-2" style={{ gap: 10, marginBottom: 10 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor={`v-name-${p.userId}`}>Full name</label>
                <input
                  id={`v-name-${p.userId}`}
                  value={details[p.userId]?.fullName ?? ""}
                  onChange={setField(p.userId, "fullName")}
                  placeholder="As on college records"
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor={`v-course-${p.userId}`}>Course</label>
                <input
                  id={`v-course-${p.userId}`}
                  value={details[p.userId]?.courseCode ?? ""}
                  onChange={setField(p.userId, "courseCode")}
                  placeholder="CSE"
                />
              </div>
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

            <div className="flex gap-8" style={{ flexWrap: "wrap" }}>
              <button
                className="btn btn-primary btn-sm"
                disabled={busy === p.userId}
                onClick={() => approve(p.userId)}
              >
                <CheckCircle2 size={14} /> Confirm
              </button>
              <button
                className="btn btn-ghost btn-sm"
                disabled={busy === p.userId}
                onClick={() => reject(p.userId)}
              >
                <XCircle size={14} /> Decline
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
