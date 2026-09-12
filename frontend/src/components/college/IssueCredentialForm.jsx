import React, { useState, useEffect, useRef } from "react";
import { FileText, CheckCircle2, AlertCircle, AlertTriangle } from "lucide-react";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../utils/api.js";
import { uploadToIPFS, buildCredentialMetadata } from "../../utils/ipfsService.js";
import { getIdempotencyKey } from "../../utils/idempotency.js";
import CorrectCredentialPanel from "../shared/CorrectCredentialPanel.jsx";

const CRED_TYPES = [
  { value: "General", label: "General / Certificate" },
  { value: "Shortlist", label: "Shortlist" },
  { value: "Interview", label: "Interview" },
  { value: "Offer", label: "Offer Letter" },
  { value: "Rejection", label: "Rejection" },
];

/**
 * An Offer is the record that marks a student placed, and placement figures
 * are what colleges are held accountable for on the public dashboard — so only
 * the employer can create one. Enforced in CredentialIssuer.sol and again in
 * the backend; filtered here so a college is never offered a choice that will
 * be refused. See FLOW_AUDIT.md, Flow 4.
 */
function typesFor(role) {
  return role === "Company" ? CRED_TYPES : CRED_TYPES.filter((t) => t.value !== "Offer");
}

export default function IssueCredentialForm({ onIssued, presetAddress }) {
  const { user, actor } = useAuth();

  const [studentAddr, setStudentAddr] = useState("");
  // Defaults to the least consequential type — "Offer" flips a student to
  // Placed, so it shouldn't be the type a college issues by just not
  // touching the dropdown.
  const [credType, setCredType] = useState("General");
  const [credTitle, setCredTitle] = useState("");
  const [credDesc, setCredDesc] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState("");
  const [issueSuccess, setIssueSuccess] = useState("");
  const [confirming, setConfirming] = useState(false);
  const idempotencyRef = useRef(null);

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

      // Same key on a retry of this exact action (server crashed or the
      // response was lost after the tx actually succeeded) so it returns the
      // original result instead of issuing a second credential.
      const idempotencyKey = getIdempotencyKey(
        idempotencyRef,
        JSON.stringify({ studentAddr, credType, credTitle, credDesc })
      );
      await api.post("/credentials/issue", { studentAddress: studentAddr, ipfsHash, credType, idempotencyKey });

      idempotencyRef.current = null; // done — a future identical action should get its own fresh key
      setIssueSuccess("Credential issued successfully.");
      setStudentAddr("");
      setCredTitle("");
      setCredDesc("");
      onIssued?.();
    } catch (err) {
      setIssueError(err.message || "Transaction failed.");
    } finally {
      setIssuing(false);
    }
  };

  return (
    <div className="flex flex-col gap-16">
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
          {typesFor(actor?.role).map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        {actor?.role !== "Company" && (
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 4 }}>
            Offer letters are issued by the company making the offer — that's what keeps
            your placement percentage something you can point to rather than something
            you assert.
          </p>
        )}
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

      {issueError && (
        <div className="alert alert-danger" role="alert">
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{issueError}</span>
        </div>
      )}
      {issueSuccess && (
        <div className="alert alert-success" role="status">
          <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{issueSuccess}</span>
        </div>
      )}

      {confirming && (
        <div className="alert alert-warning" role="alert">
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
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
            <><CheckCircle2 size={16} /> Confirm & Issue</>
          ) : (
            <><FileText size={16} /> Issue Credential</>
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
    <CorrectCredentialPanel studentAddress={studentAddr} onCorrected={onIssued} />
    </div>
  );
}
