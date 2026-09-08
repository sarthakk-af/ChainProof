import React, { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../utils/api.js";
import { uploadToIPFS, buildCredentialMetadata } from "../../utils/ipfsService.js";

const CRED_TYPES = [
  { value: "General", label: "General / Certificate" },
  { value: "Shortlist", label: "Shortlist" },
  { value: "Interview", label: "Interview" },
  { value: "Offer", label: "Offer Letter" },
  { value: "Rejection", label: "Rejection" },
];

export default function IssueCredentialForm({ onIssued, presetAddress }) {
  const { user, actor } = useAuth();

  const [studentAddr, setStudentAddr] = useState("");
  const [credType, setCredType] = useState("Offer");
  const [credTitle, setCredTitle] = useState("");
  const [credDesc, setCredDesc] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState("");
  const [issueSuccess, setIssueSuccess] = useState("");
  const [confirming, setConfirming] = useState(false);

  // Clicking a student in the registry above fills this in — still fully
  // editable by hand afterward, this is just a convenience, not a lock.
  useEffect(() => {
    if (presetAddress) {
      setStudentAddr(presetAddress);
      setConfirming(false);
    }
  }, [presetAddress]);

  const handleIssue = async (e) => {
    e.preventDefault();

    // Guards against a duplicate on-chain write: the submit button is
    // disabled while `issuing` is true, but the button's disabled attribute
    // alone doesn't stop a second submit event (e.g. a fast Enter-key
    // resubmit) that lands before React re-renders — so the handler checks
    // its own in-flight state directly instead of trusting the DOM.
    if (issuing) return;

    // Issuing a credential is permanent and on-chain — require an explicit
    // second confirmation before actually submitting.
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);

    setIssuing(true);
    setIssueError("");
    setIssueSuccess("");

    try {
      const payload = buildCredentialMetadata({
        title: credTitle || CRED_TYPES.find((t) => t.value === credType)?.label,
        description: credDesc,
        issuerName: actor?.name,
        issuerAddress: user.address,
        studentAddress: studentAddr,
        credType,
      });
      const ipfsHash = await uploadToIPFS(payload);

      await api.post("/credentials/issue", { studentAddress: studentAddr, ipfsHash, credType });

      setIssueSuccess("✅ Credential issued successfully!");
      setStudentAddr("");
      setCredTitle("");
      setCredDesc("");
      onIssued?.();
    } catch (err) {
      setIssueError("❌ " + (err.message || "Transaction failed."));
    } finally {
      setIssuing(false);
    }
  };

  return (
    <form className="glass-card p-24 flex flex-col gap-16" onSubmit={handleIssue}>
      <div className="form-group">
        <label htmlFor="col-student-addr">Student Wallet Address</label>
        <input
          id="col-student-addr"
          type="text"
          placeholder="0x..."
          value={studentAddr}
          onChange={(e) => { setStudentAddr(e.target.value); setConfirming(false); }}
          required
          style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}
        />
      </div>

      <div className="form-group">
        <label htmlFor="col-cred-type">Credential Type</label>
        <select id="col-cred-type" value={credType} onChange={(e) => { setCredType(e.target.value); setConfirming(false); }}>
          {CRED_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label htmlFor="col-cred-title">Credential Title</label>
        <input
          id="col-cred-title"
          type="text"
          placeholder="e.g. Campus Offer Letter — Google SWE 2025"
          value={credTitle}
          onChange={(e) => setCredTitle(e.target.value)}
        />
      </div>

      <div className="form-group">
        <label htmlFor="col-cred-desc">Description</label>
        <textarea
          id="col-cred-desc"
          placeholder="Additional context about this credential..."
          value={credDesc}
          onChange={(e) => setCredDesc(e.target.value)}
        />
      </div>

      {issueError && <div className="alert alert-danger"><span>❌</span><span>{issueError}</span></div>}
      {issueSuccess && <div className="alert alert-success"><span>✅</span><span>{issueSuccess}</span></div>}

      {confirming && (
        <div className="alert alert-warning">
          <span>⚠</span>
          <span>
            This will permanently issue a <strong>{CRED_TYPES.find((t) => t.value === credType)?.label}</strong>{" "}
            credential to <span className="mono-addr">{studentAddr}</span> on-chain. It cannot be edited or deleted.
          </span>
        </div>
      )}

      <div className="flex gap-8">
        <button id="issue-cred-btn" type="submit" className="btn btn-primary" disabled={issuing} style={{ flex: 1 }}>
          {issuing ? (
            <><div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Writing to the record…</>
          ) : confirming ? (
            "✅ Confirm & Issue"
          ) : (
            "📜 Issue Credential"
          )}
        </button>
        {confirming && (
          <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        )}
      </div>
      {issuing && (
        <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: 0, textAlign: "center" }}>
          This is a permanent blockchain transaction — it usually takes a few seconds to confirm.
        </p>
      )}
    </form>
  );
}
