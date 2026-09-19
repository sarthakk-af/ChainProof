/**
 * StudentDashboard.jsx — what a student can see and do.
 *
 * The one thing on this screen a student writes to the chain is their answer to
 * an offer. That is deliberate and it is the whole reason the placement figure
 * means anything: a company can extend as many offers as it likes without
 * moving any number, because only the student can say yes.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  Briefcase,
  ClipboardList,
  UserCircle,
  FileText,
  Search,
  Megaphone,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Lock,
  Clock,
} from "lucide-react";
import ResumeEditor from "./student/ResumeEditor.jsx";
import ClassmateLookup from "./student/ClassmateLookup.jsx";
import Announcements from "./shared/Announcements.jsx";
import Tabs, { useUrlTab } from "./shared/Tabs.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../utils/api.js";
import { formatDate, formatLPA } from "../utils/format.js";
import { LoadingRows } from "./shared/Loading.jsx";
import { useScrollToAlert } from "../utils/useScrollToAlert.js";

/** True while either button for `id` is working (busy is "<id>:<action>"). */
const isBusy = (busy, id) => typeof busy === "string" && busy.startsWith(`${id}:`);

const TABS = [
  { id: "open", label: "Open drives", icon: Briefcase },
  { id: "mine", label: "My applications", icon: ClipboardList },
  { id: "notices", label: "Notices", icon: Megaphone },
  { id: "profile", label: "Profile", icon: UserCircle },
  { id: "resume", label: "Resume", icon: FileText },
  { id: "classmates", label: "Find a classmate", icon: Search },
];

export default function StudentDashboard() {
  const { verification, profile } = useAuth();
  const [tab, setTab] = useUrlTab(TABS.map((t) => t.id), "open");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useScrollToAlert(error || notice);

  const verified = !!verification?.verified;
  // The roster name, never the on-chain one: a student is registered on-chain
  // under a placeholder so their real name is not written anywhere permanent.
  const displayName = profile?.fullName || "Your account";

  return (
    <div className="page-container animate-fade-in-up">
      <header className="page-head">
        <div className="section-eyebrow">Student</div>
        <h2>{displayName}</h2>
        <p>
          {verified
            ? "Apply to drives, follow where you stand, and answer your own offers."
            : "Have a look around. You can apply once you're confirmed as a student here."}
        </p>
      </header>

      {!verified && <VerificationBanner verification={verification} />}
      <OfferWaiting onOpen={() => setTab("mine")} />

      <Tabs
        tabs={TABS}
        value={tab}
        onChange={(id) => { setTab(id); setError(""); setNotice(""); }}
        label="Student sections"
      />

      {error && (
        <div className="alert alert-danger" role="alert" style={{ marginBottom: "var(--space-4)" }}>
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="alert alert-info" role="status" style={{ marginBottom: "var(--space-4)" }}>
          <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{notice}</span>
        </div>
      )}

      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
      {tab === "open" && <OpenDrives onError={setError} onNotice={setNotice} />}
      {tab === "mine" && <MyApplications onError={setError} onNotice={setNotice} />}
      {tab === "notices" && <Announcements role="Student" />}
      {tab === "profile" && <ProfilePanel onError={setError} onNotice={setNotice} />}
      {tab === "resume" && <ResumeEditor onError={setError} onNotice={setNotice} />}
      {tab === "classmates" && <ClassmateLookup />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Says exactly what is still outstanding, and what to do about it.
 *
 * The thing this replaces is a disabled button with no explanation. Every state
 * below is reachable in normal use, so each one names the next action rather
 * than just reporting a status.
 */
function VerificationBanner({ verification }) {
  const missing = verification?.missing ?? [];
  const rejected = verification?.requestStatus === "Rejected";

  if (rejected) {
    return (
      <div className="alert alert-danger" style={{ marginBottom: "var(--space-4)" }} role="alert">
        <XCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>
          <strong>Your placement cell couldn't confirm you.</strong>
          {verification.rejectionReason ? ` ${verification.rejectionReason}` : ""}{" "}
          Speak to them, then try your roll number again from the Profile tab.
        </span>
      </div>
    );
  }

  const waitingOnCell = missing.includes("collegeApproval");
  const needsEmail = missing.includes("email");
  const needsRoll = missing.includes("rollNumber");

  return (
    <div className="alert alert-warning" style={{ marginBottom: "var(--space-4)" }} role="status">
      <Clock size={16} style={{ flexShrink: 0, marginTop: 2 }} />
      <span>
        <strong>Not confirmed yet</strong> — you can browse everything, but not apply.
        <span style={{ display: "block", marginTop: 6, fontSize: "var(--text-sm)" }}>
          {needsRoll && "Add your roll number from the Profile tab. "}
          {waitingOnCell && `Your placement cell is confirming roll number ${verification.rollNumber}. `}
          {needsEmail && "Confirm your email address using the code we sent you. "}
        </span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * An offer only counts once the student answers it, so an unanswered one is
 * the most important thing on their screen — and it was buried one tab away,
 * where nothing hinted at it.
 */
function OfferWaiting({ onOpen }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    api.get("/drives/my-applications")
      .then((d) => setCount((d.applications ?? []).filter((a) => a.awaitingResponse).length))
      .catch(() => setCount(0));
  }, []);

  if (count === 0) return null;

  return (
    <div className="alert alert-info" role="status" style={{ marginBottom: "var(--space-4)" }}>
      <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 2 }} />
      <span className="flex items-center gap-12" style={{ flexWrap: "wrap" }}>
        <span>
          {count === 1 ? "You have an offer waiting for your answer." : `${count} offers are waiting for your answer.`}
        </span>
        <button type="button" className="btn btn-primary btn-sm" onClick={onOpen}>
          Answer it
        </button>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------

function OpenDrives({ onError, onNotice }) {
  const [drives, setDrives] = useState([]);
  const [busy, setBusy] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    api.get("/drives/open")
      .then((d) => setDrives(d.drives))
      .catch((e) => onError(e.message))
      .finally(() => setLoading(false));
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const apply = async (id) => {
    setBusy(id);
    onError("");
    try {
      await api.post(`/drives/${id}/apply`, {});
      onNotice("Applied.");
      load();
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <LoadingRows rows={3} label="Looking for open drives" />;

  if (drives.length === 0) {
    return (
      <div className="empty-state glass-card">
        <Briefcase className="empty-state-icon" />
        <h3>No open drives</h3>
        <p style={{ fontSize: "var(--text-sm)" }}>Openings appear once your college agrees to host them.</p>
      </div>
    );
  }

  return (
    <div className="row-list">
      {drives.map((d) => (
        <div key={d.id} className="row">
          <div style={{ minWidth: 0 }}>
            <div className="flex items-center gap-8" style={{ flexWrap: "wrap" }}>
              <strong className="item-title">{d.companyName} — {d.roleTitle}</strong>
              <span className="pill">{formatLPA(d.annualPackage)}</span>
            </div>
            <div className="row-meta" style={{ marginTop: 2 }}>
              Batch {d.batchYear}
              {d.minCgpa ? ` · CGPA ${d.minCgpa.toFixed(2)}+` : " · no CGPA cutoff"}
              {" · drive "}{formatDate(d.driveDate)}
              {" · apply by "}{formatDate(d.applicationDeadline)}
            </div>
            {!d.applied && !d.eligible && (
              /* The specific cutoff, not "not eligible" — the criteria were
                 published before applications opened, so a student turned away
                 is owed the number they actually missed. */
              <div className="row-meta flex items-center gap-6" style={{ marginTop: 4, color: "var(--accent-warning)" }}>
                <Lock size={12} /> {d.ineligibleReason}
              </div>
            )}
          </div>

          {d.applied ? (
            <span className="badge badge-student"><CheckCircle2 size={12} /> Applied</span>
          ) : d.eligible ? (
            <button className="btn btn-primary btn-sm" disabled={busy === d.id} onClick={() => apply(d.id)}>
              {busy === d.id ? <span className="spinner" /> : "Apply"}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

function MyApplications({ onError, onNotice }) {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    api.get("/drives/my-applications")
      .then((d) => setApplications(d.applications))
      .catch((e) => onError(e.message))
      .finally(() => setLoading(false));
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const answer = async (driveId, response) => {
    setBusy(`${driveId}:${response}`);
    onError("");
    try {
      await api.post(`/outcomes/${driveId}/answer`, { response });
      onNotice(response === "Accepted" ? "Offer accepted." : "Offer declined.");
      load();
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <LoadingRows rows={2} label="Checking your applications" />;

  if (applications.length === 0) {
    return (
      <div className="empty-state glass-card">
        <ClipboardList className="empty-state-icon" />
        <h3>No applications yet</h3>
        <p style={{ fontSize: "var(--text-sm)" }}>Apply to an open drive and it'll show up here.</p>
      </div>
    );
  }

  return (
    <div className="row-list">
      {applications.map((a) => (
        <div key={a.driveId} className="row">
          <div style={{ minWidth: 0 }}>
            <strong className="item-title">{a.companyName} — {a.roleTitle}</strong>
            <div className="row-meta" style={{ marginTop: 2 }}>
              {formatLPA(a.annualPackage)} · drive {formatDate(a.driveDate)}
            </div>
          </div>
          <span className="badge badge-student">{a.stageLabel || a.stage}</span>

          {a.awaitingResponse && (
            <div className="flex items-center gap-8" style={{ flexBasis: "100%", flexWrap: "wrap" }}>
              <span style={{ fontSize: "var(--text-sm)", marginRight: 4 }}>
                You have an offer. It only counts once you accept.
              </span>
              <div className="flex gap-8" style={{ flexWrap: "wrap" }}>
                <button className="btn btn-primary btn-sm" disabled={isBusy(busy, a.driveId)} onClick={() => answer(a.driveId, "Accepted")}>
                  {busy === `${a.driveId}:Accepted` ? <span className="spinner" /> : <><CheckCircle2 size={14} /> Accept</>}
                </button>
                <button className="btn btn-ghost btn-sm" disabled={isBusy(busy, a.driveId)} onClick={() => answer(a.driveId, "Declined")}>
                  {busy === `${a.driveId}:Declined` ? <span className="spinner" /> : <><XCircle size={14} /> Decline</>}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * A student's own details, and the place they add or retry a roll number.
 *
 * Both states live here deliberately. An unverified student has nowhere else to
 * go, and the banner above points them at this tab — a screen that only said
 * "you can't do this yet" would be the dead end all over again.
 */
function ProfilePanel({ onError, onNotice }) {
  const { verification, claimRollNumber, refreshActor } = useAuth();
  const [fields, setFields] = useState([]);
  const [profile, setProfile] = useState(null);
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);

  const verified = !!verification?.verified;
  const awaitingCell = verification?.requestStatus === "Pending";

  useEffect(() => {
    api.get("/me/profile-fields").then((d) => setFields(d.fields)).catch(() => {});
    api.get("/me").then((d) => {
      setProfile(d.profile);
      const initial = {};
      for (const key of Object.keys(d.profile ?? {})) {
        if (d.profile[key] !== null && d.profile[key] !== undefined) initial[key] = d.profile[key];
      }
      setValues(initial);
    }).catch((e) => onError(e.message));
  }, [onError]);

  const save = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    onError("");
    try {
      const patch = {};
      for (const f of fields) patch[f.key] = values[f.key] ?? "";
      const result = await api.patch("/me/profile", patch);
      setProfile(result.profile);
      // A CGPA change can flip eligibility, so the rest of the screen has to
      // re-read rather than keep showing stale "you don't meet the cutoff".
      await refreshActor();
      onNotice("Profile updated.");
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="split">
      <div className="stack">
        {!verified && (
          <RollNumberPanel
            verification={verification}
            awaitingCell={awaitingCell}
            onClaim={claimRollNumber}
            onError={onError}
            onNotice={onNotice}
          />
        )}

        {verified && profile?.rollNumber && (
          <div className="glass-card p-24">
            <h3 className="card-title">From your college's roster</h3>
            <dl className="facts">
              <dt>Roll number</dt><dd><span className="mono-addr">{profile.rollNumber}</span></dd>
              <dt>Name</dt><dd>{profile.fullName}</dd>
              <dt>Course</dt><dd>{profile.courseCode}</dd>
              <dt>Batch</dt><dd>{profile.batchYear}</dd>
            </dl>
            <p className="form-hint" style={{ marginTop: "var(--space-3)" }}>
              From the roster your placement cell uploaded, so it can't be edited here.
            </p>
          </div>
        )}
      </div>

      <form onSubmit={save} className="glass-card p-24 flex flex-col gap-16">
        <div>
          <h3 className="card-title">Your details</h3>
          <p className="card-lead">
            Your CGPA decides which drives you're eligible for. None of this goes on the blockchain.
          </p>
        </div>
        <div className="form-grid cols-2">
          {fields.map((f) => (
            <div className={f.multiline ? "form-group span-all" : "form-group"} key={f.key}>
              <label htmlFor={`p-${f.key}`}>
                {f.label} {!f.required && <span className="label-optional">(optional)</span>}
              </label>
              {f.multiline ? (
                <textarea
                  id={`p-${f.key}`}
                  rows={3}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              ) : (
                <input
                  id={`p-${f.key}`}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              )}
              {f.help && <p className="form-hint">{f.help}</p>}
            </div>
          ))}
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? <span className="spinner" /> : "Save"}
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Where an unverified student tells us their roll number.
 *
 * Deliberately never refuses. If the roster is already uploaded the claim
 * matches and they are confirmed on the spot; if it isn't, it goes to the
 * placement cell and they carry on browsing. The first build only handled the
 * first case and made the second a wall.
 */
function RollNumberPanel({ verification, awaitingCell, onClaim, onError, onNotice }) {
  const [colleges, setColleges] = useState([]);
  const [collegeAddress, setCollegeAddress] = useState(verification?.collegeAddress ?? "");
  const [rollNumber, setRollNumber] = useState(verification?.rollNumber ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/public/colleges")
      .then((d) => {
        setColleges(d.colleges);
        setCollegeAddress((current) => current || (d.colleges.length === 1 ? d.colleges[0].address : ""));
      })
      .catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (busy || !collegeAddress || !rollNumber.trim()) return;
    setBusy(true);
    onError("");
    try {
      const result = await onClaim({ collegeAddress, rollNumber: rollNumber.trim() });
      onNotice(
        result.queued
          ? "Sent to your placement cell to confirm."
          : "Confirmed — you can apply to drives now."
      );
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (awaitingCell) {
    return (
      <div className="glass-card p-24" style={{ marginBottom: "var(--space-4)" }}>
        <div className="flex items-center gap-12" style={{ marginBottom: "var(--space-2)" }}>
          <Clock size={20} style={{ color: "var(--accent-warning)", flexShrink: 0 }} />
          <h3 className="card-title">Waiting on your placement cell</h3>
        </div>
        <p style={{ fontSize: "var(--text-sm)" }}>
          They are confirming roll number{" "}
          <span className="mono-addr">{verification?.rollNumber}</span>. Once they do, you
          can apply to drives.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="glass-card p-24 flex flex-col gap-16" style={{ marginBottom: "var(--space-4)" }}>
      <div>
        <h3 className="card-title">Confirm you study here</h3>
        <p className="card-lead">
          Your roll number is what ties this account to a real student. You're confirmed
          instantly if your college listed this roll number against the email you signed
          up with; otherwise your placement cell gets it to check.
        </p>
      </div>

      <div className="form-group">
        <label htmlFor="rp-college">Your college</label>
        <select id="rp-college" value={collegeAddress} onChange={(e) => setCollegeAddress(e.target.value)} required>
          <option value="">Select…</option>
          {colleges.map((c) => <option key={c.address} value={c.address}>{c.name}</option>)}
        </select>
      </div>

      <div className="form-group">
        <label htmlFor="rp-roll">Roll number</label>
        <input
          id="rp-roll"
          value={rollNumber}
          onChange={(e) => setRollNumber(e.target.value.toUpperCase())}
          placeholder="e.g. 21CE1042"
          required
        />
      </div>

      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? <span className="spinner" /> : "Confirm"}
      </button>
    </form>
  );
}
