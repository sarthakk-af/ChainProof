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
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../utils/api.js";
import { formatDate } from "../utils/format.js";

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
  const [tab, setTab] = useState("open");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const verified = !!verification?.verified;
  // The roster name, never the on-chain one: a student is registered on-chain
  // under a placeholder so their real name is not written anywhere permanent.
  const displayName = profile?.fullName || "Your account";

  return (
    <div className="page-container animate-fade-in-up">
      <div className="section-eyebrow">Student</div>
      <h2 style={{ marginBottom: 4 }}>{displayName}</h2>
      <p style={{ marginBottom: 16, fontSize: "0.85rem", color: "var(--text-muted)" }}>
        {verified
          ? "Apply to drives, follow where you stand, and answer your own offers."
          : "Have a look around. You can apply once you're confirmed as a student here."}
      </p>

      {!verified && <VerificationBanner verification={verification} />}

      <div className="board-toolbar" style={{ flexWrap: "wrap", marginBottom: 24 }}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={tab === id ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}
            onClick={() => { setTab(id); setError(""); setNotice(""); }}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

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

      {tab === "open" && <OpenDrives onError={setError} onNotice={setNotice} />}
      {tab === "mine" && <MyApplications onError={setError} onNotice={setNotice} />}
      {tab === "notices" && <Announcements role="Student" />}
      {tab === "profile" && <ProfilePanel onError={setError} onNotice={setNotice} />}
      {tab === "resume" && <ResumeEditor onError={setError} onNotice={setNotice} />}
      {tab === "classmates" && <ClassmateLookup />}
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
      <div className="alert alert-danger" style={{ marginBottom: 20 }} role="status">
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
    <div className="alert alert-warning" style={{ marginBottom: 20 }} role="status">
      <Clock size={16} style={{ flexShrink: 0, marginTop: 2 }} />
      <span>
        <strong>Not confirmed yet</strong> — you can browse everything, but not apply.
        <span style={{ display: "block", marginTop: 6, fontSize: "0.82rem" }}>
          {needsRoll && "Add your roll number from the Profile tab. "}
          {waitingOnCell && `Your placement cell is confirming roll number ${verification.rollNumber}. `}
          {needsEmail && "Confirm your email address using the code we sent you. "}
        </span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------

function OpenDrives({ onError, onNotice }) {
  const [drives, setDrives] = useState([]);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    api.get("/drives/open").then((d) => setDrives(d.drives)).catch((e) => onError(e.message));
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

  if (drives.length === 0) {
    return (
      <div className="empty-state glass-card">
        <Briefcase size={48} className="empty-state-icon" />
        <h3>No open drives</h3>
        <p style={{ fontSize: "0.85rem" }}>Openings appear once your college agrees to host them.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      {drives.map((d) => (
        <div key={d.id} className="glass-card" style={{ padding: "16px 20px" }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
            <strong style={{ fontFamily: "var(--font-head)" }}>{d.companyName} — {d.roleTitle}</strong>
            <span className="badge badge-company">₹{d.annualPackage.toLocaleString("en-IN")}</span>
          </div>
          <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: 12 }}>
            Batch {d.batchYear}
            {d.minCgpa ? ` · CGPA ${d.minCgpa.toFixed(2)}+` : " · no CGPA cutoff"}
            {" · drive "}{formatDate(d.driveDate)}
            {" · applications close "}{formatDate(d.applicationDeadline)}
          </div>

          {d.applied ? (
            <span className="badge badge-student"><CheckCircle2 size={12} /> Applied</span>
          ) : d.eligible ? (
            <button className="btn btn-primary btn-sm" disabled={busy === d.id} onClick={() => apply(d.id)}>
              {busy === d.id ? <span className="spinner" /> : "Apply"}
            </button>
          ) : (
            <div className="alert alert-warning" style={{ fontSize: "0.8rem" }}>
              <Lock size={15} style={{ flexShrink: 0, marginTop: 2 }} />
              {/* The specific cutoff, not "not eligible" — the criteria were
                  published before applications opened, so a student turned away
                  is owed the number they actually missed. */}
              <span>{d.ineligibleReason}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

function MyApplications({ onError, onNotice }) {
  const [applications, setApplications] = useState([]);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    api.get("/drives/my-applications")
      .then((d) => setApplications(d.applications))
      .catch((e) => onError(e.message));
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const answer = async (driveId, response) => {
    setBusy(driveId);
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

  if (applications.length === 0) {
    return (
      <div className="empty-state glass-card">
        <ClipboardList size={48} className="empty-state-icon" />
        <h3>No applications yet</h3>
        <p style={{ fontSize: "0.85rem" }}>Apply to an open drive and it'll show up here.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      {applications.map((a) => (
        <div key={a.driveId} className="glass-card" style={{ padding: "16px 20px" }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
            <strong style={{ fontFamily: "var(--font-head)" }}>{a.companyName} — {a.roleTitle}</strong>
            <span className="badge badge-student">{a.stageLabel || a.stage}</span>
          </div>
          <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: a.awaitingResponse ? 12 : 0 }}>
            ₹{a.annualPackage.toLocaleString("en-IN")} · drive {formatDate(a.driveDate)}
          </div>

          {a.awaitingResponse && (
            <>
              <p style={{ fontSize: "0.8rem", marginBottom: 10 }}>
                You have an offer. It only counts as a placement once you accept —
                nobody can answer this for you.
              </p>
              <div className="flex gap-8" style={{ flexWrap: "wrap" }}>
                <button className="btn btn-primary btn-sm" disabled={busy === a.driveId} onClick={() => answer(a.driveId, "Accepted")}>
                  <CheckCircle2 size={14} /> Accept
                </button>
                <button className="btn btn-ghost btn-sm" disabled={busy === a.driveId} onClick={() => answer(a.driveId, "Declined")}>
                  <XCircle size={14} /> Decline
                </button>
              </div>
            </>
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
    <>
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
        <div className="glass-card p-24" style={{ marginBottom: 20 }}>
          <div className="section-eyebrow" style={{ marginBottom: 12 }}>From your college's roster</div>
          <div style={{ fontSize: "0.88rem", lineHeight: 1.8 }}>
            <div>Roll number: <span className="mono-addr">{profile.rollNumber}</span></div>
            <div>Name: {profile.fullName}</div>
            <div>Course: {profile.courseCode} · Batch {profile.batchYear}</div>
          </div>
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 12 }}>
            These come from the roster your placement cell uploaded and can't be edited
            here — that's what lets the platform say you really study at this college.
          </p>
        </div>
      )}

      <form onSubmit={save} className="glass-card p-24 flex flex-col gap-16">
        <div className="section-eyebrow" style={{ marginBottom: 0 }}>Your details</div>
        {fields.map((f) => (
          <div className="form-group" key={f.key}>
            <label htmlFor={`p-${f.key}`}>
              {f.label} {!f.required && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(optional)</span>}
            </label>
            <input
              id={`p-${f.key}`}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            />
            {f.help && <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 4 }}>{f.help}</p>}
          </div>
        ))}
        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
          Your CGPA decides which drives you're eligible for. None of this is written to
          the blockchain — on-chain you're only a wallet address.
        </p>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? <span className="spinner" /> : "Save"}
        </button>
      </form>
    </>
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
      <div className="glass-card p-24" style={{ marginBottom: 20 }}>
        <div className="flex items-center gap-12" style={{ marginBottom: 10 }}>
          <Clock size={20} style={{ color: "var(--accent-warning)", flexShrink: 0 }} />
          <strong style={{ fontFamily: "var(--font-head)" }}>Waiting on your placement cell</strong>
        </div>
        <p style={{ fontSize: "0.86rem" }}>
          They are confirming roll number{" "}
          <span className="mono-addr">{verification?.rollNumber}</span>. Once they do, you
          can apply to drives.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="glass-card p-24 flex flex-col gap-16" style={{ marginBottom: 20 }}>
      <div>
        <strong style={{ fontFamily: "var(--font-head)" }}>Confirm you study here</strong>
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>
          Your roll number is what ties this account to a real student. If the roster is
          already uploaded you are confirmed instantly; if not, your placement cell gets
          it to check.
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
