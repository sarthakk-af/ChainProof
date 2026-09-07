import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../utils/api.js";
import { uploadToIPFS, buildCredentialMetadata } from "../../utils/ipfsService.js";

const PIPELINE_STAGES = [
  { value: "Shortlist", label: "Shortlisted", icon: "⭐", btnClass: "btn-warning" },
  { value: "Interview", label: "Interviewed", icon: "🎙️", btnClass: "btn-secondary" },
  { value: "Offer", label: "Offer", icon: "🎉", btnClass: "btn-success" },
  { value: "Rejection", label: "Rejection", icon: "❌", btnClass: "btn-danger" },
];

function shortAddr(addr) { return addr?.slice(0, 6) + "…" + addr?.slice(-4); }

export default function PipelineActionPanel({ activeStudent, onDeselect, onIssued }) {
  const { user, actor } = useAuth();

  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError] = useState("");
  const [txSuccess, setTxSuccess] = useState("");
  const [noteText, setNoteText] = useState("");

  const [manualAddr, setManualAddr] = useState("");
  const [manualStage, setManualStage] = useState("Shortlist");
  const [confirming, setConfirming] = useState(false);

  // Clear stale messages when the user picks a *different* student — but not
  // when activeStudent goes back to null (deselecting, including the
  // auto-deselect after a successful issue, which should keep showing the
  // success message).
  const prevAddressRef = useRef(null);
  useEffect(() => {
    if (activeStudent && activeStudent.address !== prevAddressRef.current) {
      setTxError("");
      setTxSuccess("");
      setNoteText("");
      setConfirming(false);
    }
    prevAddressRef.current = activeStudent?.address ?? null;
  }, [activeStudent]);

  const issuePipelineCredential = async (studentAddress, stage) => {
    if (!studentAddress || !stage) return;
    setTxLoading(true);
    setTxError("");
    setTxSuccess("");

    const stageInfo = PIPELINE_STAGES.find((s) => s.value === stage);
    if (!stageInfo) return;

    try {
      const payload = buildCredentialMetadata({
        title: `${stageInfo.label} — ${actor?.name}`,
        description: noteText || `Recruitment pipeline update: ${stageInfo.label}`,
        issuerName: actor?.name,
        issuerAddress: user.address,
        studentAddress,
        credType: stageInfo.label,
      });
      const ipfsHash = await uploadToIPFS(payload);

      await api.post("/credentials/issue", { studentAddress, ipfsHash, credType: stage });

      setTxSuccess(`${stageInfo.icon} ${stageInfo.label} credential issued!`);
      setNoteText("");
      onDeselect();
      onIssued();
    } catch (err) {
      setTxError("❌ " + (err.message || "Transaction failed."));
    } finally {
      setTxLoading(false);
    }
  };

  const handleManualIssue = (e) => {
    e.preventDefault();

    // A one-off manual issuance (no student selected/verified from the
    // registry first) is riskier than the pipeline buttons above — require
    // an explicit second confirmation before it hits the chain.
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    issuePipelineCredential(manualAddr, manualStage);
  };

  return (
    <>
      {txSuccess && (
        <div className="alert alert-success animate-fade-in-up" style={{ marginBottom: 16 }}>
          <span>✅</span><span>{txSuccess}</span>
        </div>
      )}
      {txError && (
        <div className="alert alert-danger animate-fade-in-up" style={{ marginBottom: 16 }}>
          <span>❌</span><span>{txError}</span>
        </div>
      )}

      {activeStudent ? (
        <div className="glass-card p-24 animate-fade-in-up flex flex-col gap-16">
          <div style={{ padding: "12px 16px", background: "rgba(108,99,255,0.08)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-subtle)" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 4 }}>Selected Student</div>
            <strong style={{ fontFamily: "var(--font-head)" }}>{activeStudent.name}</strong>
            <div className="mono-addr" style={{ marginTop: 4, fontSize: "0.72rem" }}>{shortAddr(activeStudent.address)}</div>
          </div>

          <div className="form-group">
            <label htmlFor="pipeline-note">Note / Reason (optional)</label>
            <textarea
              id="pipeline-note"
              placeholder="Add a note about this stage update..."
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              style={{ minHeight: 60 }}
            />
          </div>

          <div className="section-eyebrow" style={{ marginBottom: 4 }}>Progress to Stage</div>
          <div className="flex flex-col gap-10">
            {PIPELINE_STAGES.map((stage) => (
              <button
                key={stage.value}
                id={`stage-btn-${stage.label.toLowerCase()}`}
                className={`btn ${stage.btnClass}`}
                disabled={txLoading}
                onClick={() => issuePipelineCredential(activeStudent.address, stage.value)}
              >
                {txLoading ? (
                  <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                ) : (
                  stage.icon
                )}
                {stage.label}
              </button>
            ))}
          </div>

          <button className="btn btn-ghost btn-sm" onClick={onDeselect}>
            ← Deselect
          </button>
        </div>
      ) : (
        <div className="glass-card p-24 flex flex-col gap-16">
          <div className="empty-state" style={{ padding: "24px 0" }}>
            <div className="empty-state-icon" style={{ fontSize: "2.5rem" }}>👈</div>
            <p style={{ fontSize: "0.85rem" }}>Select a student from the list to progress them through the pipeline.</p>
          </div>

          <div className="divider" />
          <div className="section-eyebrow">Manual — Issue by Address</div>
          <form onSubmit={handleManualIssue} className="flex flex-col gap-12">
            <div className="form-group">
              <label htmlFor="manual-addr">Student Address</label>
              <input
                id="manual-addr"
                type="text"
                placeholder="0x..."
                value={manualAddr}
                onChange={(e) => { setManualAddr(e.target.value); setConfirming(false); }}
                style={{ fontFamily: "var(--font-mono)", fontSize: "0.82rem" }}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="manual-stage">Stage</label>
              <select
                id="manual-stage"
                value={manualStage}
                onChange={(e) => { setManualStage(e.target.value); setConfirming(false); }}
              >
                {PIPELINE_STAGES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            {confirming && (
              <div className="alert alert-warning" style={{ fontSize: "0.8rem" }}>
                <span>⚠</span>
                <span>
                  This will permanently issue a <strong>{manualStage}</strong> credential to{" "}
                  <span className="mono-addr">{manualAddr}</span> on-chain.
                </span>
              </div>
            )}

            <div className="flex gap-8">
              <button type="submit" className="btn btn-primary" disabled={txLoading} style={{ flex: 1 }}>
                {txLoading ? "Issuing…" : confirming ? "✅ Confirm & Issue" : "📤 Issue"}
              </button>
              {confirming && (
                <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </>
  );
}
