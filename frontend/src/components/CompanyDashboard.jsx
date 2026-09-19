/**
 * CompanyDashboard.jsx — the recruiter's console.
 *
 * Everything a company writes here it writes about itself: its own openings,
 * its own terms, its own decisions about its own applicants. Nothing on this
 * screen can be authored by the college, and nothing here can mark a student
 * placed — an offer only counts once the student accepts it.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  Ban,
  Briefcase,
  Users,
  Megaphone,
  Plus,
  AlertCircle,
  CheckCircle2,
  Send,
  Lock,
  ChevronRight,
} from "lucide-react";
import TalentPool from "./company/TalentPool.jsx";
import Announcements from "./shared/Announcements.jsx";
import Tabs, { useUrlTab } from "./shared/Tabs.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../utils/api.js";
import { uploadToIPFS } from "../utils/ipfsService.js";
import { getIdempotencyKey } from "../utils/idempotency.js";
import { formatDate } from "../utils/format.js";
import { LoadingRows } from "./shared/Loading.jsx";
import { useScrollToAlert } from "../utils/useScrollToAlert.js";

const STAGES = ["Shortlisted", "Assessment", "Interview", "Offered", "NotSelected"];
const STAGE_LABEL = {
  Shortlisted: "Shortlisted",
  Assessment: "Assessment",
  Interview: "Interview",
  Offered: "Offer",
  NotSelected: "Not selected",
};

const TABS = [
  { id: "drives", label: "Your drives", icon: Briefcase },
  { id: "students", label: "Students", icon: Users },
  { id: "notices", label: "Notices", icon: Megaphone },
];

export default function CompanyDashboard() {
  const { actor } = useAuth();
  const [tab, setTab] = useUrlTab(TABS.map((t) => t.id), "drives");
  const [drives, setDrives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [showPost, setShowPost] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useScrollToAlert(error || notice);

  const load = useCallback(() => {
    api.get("/drives/mine")
      .then((d) => setDrives(d.drives))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="page-container animate-fade-in-up">
      <header className="page-head">
        <div className="section-eyebrow">Recruiter</div>
        <h2>{actor?.name}</h2>
        <p>
          You set your own terms and record your own decisions. The college decides only
          whether a drive runs on its campus.
        </p>
      </header>

      <Tabs
        tabs={TABS}
        value={tab}
        onChange={(id) => { setTab(id); setError(""); setNotice(""); }}
        label="Recruiter sections"
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
      {tab === "students" && <TalentPool />}
      {tab === "notices" && <Announcements role="Company" drives={drives} />}

      {tab === "drives" && (
      <>
      <div className="section-head">
        <div className="section-eyebrow">Your drives ({drives.length})</div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowPost((v) => !v)}>
          <Plus size={14} /> {showPost ? "Cancel" : "Post a drive"}
        </button>
      </div>

      {showPost && (
        <PostDriveForm
          onPosted={() => { setShowPost(false); setNotice("Posted. The college will decide whether to host it."); load(); }}
          onError={setError}
        />
      )}

      {loading ? (
        <LoadingRows rows={2} label="Fetching your drives" />
      ) : drives.length === 0 && !showPost ? (
        <div className="empty-state glass-card">
          <Briefcase className="empty-state-icon" />
          <h3>No drives yet</h3>
          <p style={{ fontSize: "var(--text-sm)" }}>Post one and the college will decide whether to host it.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-10">
          {drives.map((d) => (
            <DriveCard
              key={d.id}
              drive={d}
              expanded={selected === d.id}
              onToggle={() => setSelected(selected === d.id ? null : d.id)}
              onChanged={() => { load(); }}
              onError={setError}
              onNotice={setNotice}
            />
          ))}
        </div>
      )}
      </>
      )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function PostDriveForm({ onPosted, onError }) {
  const [colleges, setColleges] = useState([]);
  const [form, setForm] = useState({
    collegeAddress: "",
    roleTitle: "",
    annualPackage: "",
    minCgpa: "",
    batchYear: "",
    applicationDeadline: "",
    driveDate: "",
    description: "",
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/public/colleges").then((d) => {
      setColleges(d.colleges);
      if (d.colleges.length === 1) setForm((f) => ({ ...f, collegeAddress: d.colleges[0].address }));
    }).catch(() => {});
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    onError("");
    try {
      // The full description goes to IPFS; only its hash is written on-chain,
      // which keeps the permanent record small and tamper-evident at once.
      const ipfsHash = await uploadToIPFS({
        schema: "chainproof-drive-v1",
        roleTitle: form.roleTitle,
        description: form.description,
        annualPackage: Number(form.annualPackage),
        postedAt: new Date().toISOString(),
      });

      await api.post("/drives", {
        collegeAddress: form.collegeAddress,
        roleTitle: form.roleTitle.trim(),
        annualPackage: Number(form.annualPackage),
        minCgpa: form.minCgpa === "" ? 0 : Number(form.minCgpa),
        batchYear: Number(form.batchYear),
        applicationDeadline: Math.floor(new Date(form.applicationDeadline).getTime() / 1000),
        driveDate: Math.floor(new Date(form.driveDate).getTime() / 1000),
        ipfsHash,
        idempotencyKey: getIdempotencyKey("post-drive", JSON.stringify(form)),
      });
      onPosted();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="glass-card p-24 flex flex-col gap-12" style={{ marginBottom: "var(--space-4)" }}>
      <div className="form-grid">
        <div className="form-group">
          <label htmlFor="d-role">Role title</label>
          <input id="d-role" value={form.roleTitle} onChange={set("roleTitle")} placeholder="Software Engineer" required />
        </div>
        {/* With one college on the platform it is already chosen, so the picker
            only appears when there is actually a choice to make. */}
        {colleges.length !== 1 && (
          <div className="form-group">
            <label htmlFor="d-college">College</label>
            <select id="d-college" value={form.collegeAddress} onChange={set("collegeAddress")} required>
              <option value="">Select…</option>
              {colleges.map((c) => <option key={c.address} value={c.address}>{c.name}</option>)}
            </select>
          </div>
        )}
        <div className="form-group">
          <label htmlFor="d-package">Annual package (₹)</label>
          <input id="d-package" type="number" inputMode="decimal" value={form.annualPackage} onChange={set("annualPackage")} placeholder="650000" required />
        </div>
        <div className="form-group">
          <label htmlFor="d-cgpa">Minimum CGPA <span className="label-optional">(optional)</span></label>
          <input id="d-cgpa" type="number" inputMode="decimal" step="0.01" min="0" max="10" value={form.minCgpa} onChange={set("minCgpa")} placeholder="7.00" />
        </div>
        <div className="form-group">
          <label htmlFor="d-batch">Batch year</label>
          <input id="d-batch" type="number" inputMode="decimal" value={form.batchYear} onChange={set("batchYear")} placeholder="2026" required />
        </div>
        <div className="form-group">
          <label htmlFor="d-deadline">Applications close</label>
          <input id="d-deadline" type="date" value={form.applicationDeadline} onChange={set("applicationDeadline")} required />
        </div>
        <div className="form-group">
          <label htmlFor="d-date">Drive date</label>
          <input id="d-date" type="date" value={form.driveDate} onChange={set("driveDate")} required />
        </div>
        <div className="form-group span-all">
          <label htmlFor="d-desc">Description <span className="label-optional">(optional)</span></label>
          <textarea id="d-desc" rows={3} value={form.description} onChange={set("description")} />
        </div>
      </div>

      <p className="form-hint" style={{ margin: 0 }}>
        The package and CGPA cutoff go on-chain before applications open, so they can't be changed later.
      </p>

      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? <span className="spinner" /> : <><Send size={16} /> Post opening</>}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------

function DriveCard({ drive, expanded, onToggle, onChanged, onError, onNotice }) {
  const [applicants, setApplicants] = useState([]);
  const [busy, setBusy] = useState(null);
  const [confirming, setConfirming] = useState(null);

  const loadApplicants = useCallback(() => {
    if (!expanded) return;
    api.get(`/drives/${drive.id}/applicants`)
      .then((d) => setApplicants(d.applicants))
      .catch((e) => onError(e.message));
  }, [expanded, drive.id, onError]);

  useEffect(() => { loadApplicants(); }, [loadApplicants]);

  const recordStage = async (address, stage) => {
    setBusy(address + stage);
    onError("");
    try {
      await api.post(`/outcomes/${drive.id}/stage`, {
        studentAddress: address,
        stage,
        label: "",
        idempotencyKey: getIdempotencyKey("stage", `${drive.id}:${address}:${stage}`),
      });
      onNotice(`Recorded: ${STAGE_LABEL[stage]}`);
      loadApplicants();
      onChanged();
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(null);
    }
  };

  /**
   * Stops a drive the company posted.
   *
   * Closing ends applications; cancelling calls the whole thing off. Both were
   * in the backend and on the chain from the start, with no button anywhere —
   * so a drive posted with the wrong date or the wrong package simply stood
   * there, collecting applications nobody intended to read.
   */
  const stopDrive = async (action) => {
    setBusy(action);
    onError("");
    try {
      await api.post(`/drives/${drive.id}/${action}`, {});
      onNotice(
        action === "close"
          ? "Applications closed. The drive and everything recorded against it stay on the record."
          : "Drive cancelled. It stays on the record as cancelled — nothing is erased."
      );
      setConfirming(null);
      onChanged();
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const publishCount = async () => {
    setBusy("count");
    onError("");
    try {
      const r = await api.post(`/drives/${drive.id}/application-count`, {});
      onNotice(`Published: ${r.applicationCount} applied.`);
      onChanged();
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const unpublished = drive.applicationCount !== drive.applicationsReceived;

  return (
    <div className="glass-card is-interactive" style={{ padding: "16px 20px" }}>
      <div
        className="flex items-center justify-between"
        style={{ cursor: "pointer", flexWrap: "wrap", gap: "var(--space-2)" }}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
      >
        <div>
          <strong className="item-title">{drive.roleTitle}</strong>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
            {drive.collegeName} · batch {drive.batchYear} · {formatDate(drive.driveDate)}
          </div>
        </div>
        {/* Says what clicking does, instead of leaving a plain card that
            happens to open. */}
        <div className="flex items-center gap-12">
          <span className="badge badge-company">{drive.status}</span>
          <span className="card-action">
            {expanded ? "Hide applicants" : `Manage applicants · ${drive.applicationsReceived ?? 0}`}
            <ChevronRight size={15} className={expanded ? "chev open" : "chev"} aria-hidden="true" />
          </span>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: "var(--space-4)" }}>
          <div className="flex items-center justify-between" style={{ marginBottom: "var(--space-3)", flexWrap: "wrap", gap: "var(--space-2)" }}>
            <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
              {drive.applicationsReceived} applied
              {drive.applicationCount !== null && ` · ${drive.applicationCount} published on-chain`}
            </span>
            <span className="flex gap-8" style={{ flexWrap: "wrap" }}>
              {unpublished && (
                <button className="btn btn-ghost btn-sm" onClick={publishCount} disabled={busy === "count"}>
                  {busy === "count" ? <span className="spinner" /> : <><Lock size={14} /> Publish the applicant count</>}
                </button>
              )}
              {/* Stopping a drive is rare and permanent, so it asks first and
                  says what survives: the record, which is the point. */}
              {drive.status === "Approved" && !confirming && (
                <button className="btn btn-ghost btn-sm" onClick={() => setConfirming("choose")}>
                  <Ban size={14} /> Stop this drive
                </button>
              )}
            </span>
          </div>

          {confirming === "choose" && (
            <div className="alert alert-warning" role="status" style={{ marginBottom: "var(--space-3)", display: "block" }}>
              <p style={{ marginBottom: "var(--space-2)" }}>
                <strong>Close applications</strong> keeps the drive and lets you carry on recording
                stages. <strong>Cancel the drive</strong> calls it off entirely. Either way the
                drive and everything already recorded stay on the record — nothing is erased.
              </p>
              <div className="flex gap-8" style={{ flexWrap: "wrap" }}>
                <button className="btn btn-ghost btn-sm" onClick={() => stopDrive("close")} disabled={!!busy}>
                  {busy === "close" ? <span className="spinner" /> : "Close applications"}
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => stopDrive("cancel")} disabled={!!busy}>
                  {busy === "cancel" ? <span className="spinner" /> : "Cancel the drive"}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(null)}>
                  Never mind
                </button>
              </div>
            </div>
          )}
          {unpublished && (
            <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginBottom: "var(--space-3)" }}>
              The public funnel shows the figure you sign, not the one our database
              counted — because this platform is run by the college whose success rate
              that number shapes.
            </p>
          )}

          {applicants.length === 0 ? (
            <div className="empty-state"><p>Nobody has applied yet.</p></div>
          ) : (
            <div className="flex flex-col gap-8">
              {applicants.map((a) => (
                <div key={a.address} className="glass-card" style={{ padding: "10px 14px" }}>
                  <div className="flex items-center justify-between" style={{ flexWrap: "wrap", gap: "var(--space-2)", marginBottom: "var(--space-2)" }}>
                    <span style={{ fontSize: "var(--text-sm)" }}>
                      <span className="mono-addr">{a.rollNumber}</span> · {a.fullName}
                      {a.cgpa !== null && <span style={{ color: "var(--text-muted)" }}> · CGPA {a.cgpa.toFixed(2)}</span>}
                    </span>
                    <span className="badge badge-student">{a.stage ? STAGE_LABEL[a.stage] ?? a.stage : "Applied"}</span>
                  </div>
                  <div className="flex gap-8" style={{ flexWrap: "wrap" }}>
                    {STAGES.filter((s) => s !== a.stage).map((s) => (
                      <button
                        key={s}
                        className="btn btn-ghost btn-sm"
                        disabled={typeof busy === "string" && busy.startsWith(a.address)}
                        onClick={() => recordStage(a.address, s)}
                      >
                        {busy === a.address + s ? <span className="spinner" /> : STAGE_LABEL[s]}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
