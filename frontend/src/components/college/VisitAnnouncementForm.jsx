import React, { useState, useRef } from "react";
import { Megaphone, CheckCircle2, AlertCircle, AlertTriangle } from "lucide-react";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../utils/api.js";
import { uploadToIPFS } from "../../utils/ipfsService.js";
import { getIdempotencyKey } from "../../utils/idempotency.js";

export default function VisitAnnouncementForm({ onAnnounced }) {
  const { user, actor } = useAuth();

  const [visitCompany, setVisitCompany] = useState("");
  const [visitDate, setVisitDate] = useState("");
  const [visitDesc, setVisitDesc] = useState("");
  const [addingVisit, setAddingVisit] = useState(false);
  const [visitError, setVisitError] = useState("");
  const [visitSuccess, setVisitSuccess] = useState("");
  const [confirming, setConfirming] = useState(false);
  const idempotencyRef = useRef(null);

  const handleAddVisit = async (e) => {
    e.preventDefault();

    // See IssueCredentialForm.jsx's handleIssue for why this checks the
    // in-flight state directly rather than trusting the button's disabled attribute.
    if (addingVisit) return;

    // Permanent on-chain record — require an explicit second confirmation.
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);

    setAddingVisit(true);
    setVisitError("");
    setVisitSuccess("");
    try {
      const payload = {
        schema: "chainproof-visit-v1",
        companyName: visitCompany,
        visitDate,
        description: visitDesc,
        publishedBy: actor?.name,
        publisherAddress: user.address,
        publishedAt: new Date().toISOString(),
      };
      const ipfsHash = await uploadToIPFS(payload);
      const visitDateUnix = Math.floor(new Date(visitDate).getTime() / 1000);

      const idempotencyKey = getIdempotencyKey(
        idempotencyRef,
        JSON.stringify({ visitCompany, visitDate, visitDesc })
      );
      await api.post("/visits/announce", { companyName: visitCompany, ipfsHash, visitDate: visitDateUnix, idempotencyKey });

      idempotencyRef.current = null;
      setVisitSuccess("Visit announcement published successfully.");
      setVisitCompany("");
      setVisitDate("");
      setVisitDesc("");
      onAnnounced?.();
    } catch (err) {
      setVisitError(err.message || "Could not publish announcement.");
    } finally {
      setAddingVisit(false);
    }
  };

  return (
    <form className="glass-card p-24 flex flex-col gap-12" onSubmit={handleAddVisit} style={{ marginBottom: 20 }}>
      <p style={{ fontSize: "0.85rem", margin: 0 }}>
        Publish a company visit schedule as a permanent on-chain record. Once saved, it cannot be altered.
      </p>
      <div className="form-group">
        <label htmlFor="visit-company">Company Name</label>
        <input id="visit-company" type="text" placeholder="e.g. Microsoft India" value={visitCompany} onChange={(e) => { setVisitCompany(e.target.value); setConfirming(false); }} required />
      </div>
      <div className="form-group">
        <label htmlFor="visit-date">Visit Date</label>
        <input id="visit-date" type="date" value={visitDate} onChange={(e) => { setVisitDate(e.target.value); setConfirming(false); }} required />
      </div>
      <div className="form-group">
        <label htmlFor="visit-desc">Details / Roles</label>
        <textarea id="visit-desc" placeholder="Roles offered, eligibility criteria..." value={visitDesc} onChange={(e) => setVisitDesc(e.target.value)} style={{ minHeight: 70 }} />
      </div>
      {visitError && (
        <div className="alert alert-danger" role="alert">
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{visitError}</span>
        </div>
      )}
      {visitSuccess && (
        <div className="alert alert-success" role="status">
          <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{visitSuccess}</span>
        </div>
      )}

      {confirming && (
        <div className="alert alert-warning" role="alert">
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            This will permanently publish a visit announcement for <strong>{visitCompany}</strong> on-chain.
            It cannot be edited or deleted.
          </span>
        </div>
      )}

      <div className="flex gap-8">
        <button id="add-visit-btn" type="submit" className="btn btn-secondary" disabled={addingVisit} style={{ flex: 1 }}>
          {addingVisit ? "Writing to the record…" : confirming ? <><CheckCircle2 size={16} /> Confirm & Publish</> : <><Megaphone size={16} /> Publish Announcement</>}
        </button>
        {confirming && (
          <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        )}
      </div>
      {addingVisit && (
        <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: 0, textAlign: "center" }}>
          This is a permanent blockchain transaction — it usually takes a few seconds to confirm.
        </p>
      )}
    </form>
  );
}
