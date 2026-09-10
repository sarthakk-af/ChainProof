/**
 * CorrectCredentialPanel.jsx — Lets an issuer correct a credential they
 * issued earlier (e.g. rescinding an offer, fixing a typo'd grade) without
 * ever editing or deleting the original — see CredentialIssuer.sol's
 * issueCorrection. Shown under the issue form once a valid, known student
 * address is entered; only surfaces credentials *this* issuer wrote that
 * haven't already been corrected once.
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { PenLine, CheckCircle2, AlertCircle, AlertTriangle } from "lucide-react";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../utils/api.js";
import { uploadToIPFS, buildCredentialMetadata } from "../../utils/ipfsService.js";
import { CRED_TYPE_META } from "../../utils/credentialMeta.js";
import { getIdempotencyKey } from "../../utils/idempotency.js";

const CRED_TYPES = ["General", "Shortlist", "Interview", "Offer", "Rejection"];

export default function CorrectCredentialPanel({ studentAddress, onCorrected }) {
  const { user, actor } = useAuth();

  const [credentials, setCredentials] = useState([]);
  const [loading, setLoading] = useState(false);
  const [correctingId, setCorrectingId] = useState(null);
  const [newType, setNewType] = useState("Rejection");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const idempotencyRef = useRef(null);

  const isValidAddress = /^0x[a-fA-F0-9]{40}$/.test(studentAddress || "");

  const load = useCallback(async () => {
    if (!isValidAddress) {
      setCredentials([]);
      return;
    }
    setLoading(true);
    try {
      const data = await api.get(`/students/${studentAddress}/credentials`);
      setCredentials(
        data.credentials.filter(
          (c) => c.issuerAddress.toLowerCase() === user.address.toLowerCase() && !c.superseded
        )
      );
    } catch {
      setCredentials([]);
    } finally {
      setLoading(false);
    }
  }, [studentAddress, isValidAddress, user.address]);

  useEffect(() => {
    load();
    setCorrectingId(null);
    setConfirming(false);
    setError("");
  }, [load]);

  if (!isValidAddress || loading || credentials.length === 0) return null;

  const handleCorrect = async (id) => {
    if (submitting) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setSubmitting(true);
    setError("");
    try {
      const payload = buildCredentialMetadata({
        title: `Correction — ${newType}`,
        description: reason,
        issuerName: actor?.name,
        issuerAddress: user.address,
        studentAddress,
        credType: newType,
      });
      const ipfsHash = await uploadToIPFS(payload);

      const idempotencyKey = getIdempotencyKey(idempotencyRef, JSON.stringify({ id, newType, reason }));
      await api.post(`/credentials/${id}/correct`, { studentAddress, ipfsHash, credType: newType, idempotencyKey });

      idempotencyRef.current = null;
      setCorrectingId(null);
      setReason("");
      onCorrected?.();
      load();
    } catch (err) {
      setError(err.message || "Correction failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="glass-card p-16 flex flex-col gap-10" style={{ background: "rgba(0,0,0,0.03)" }}>
      <div className="section-eyebrow" style={{ marginBottom: 0 }}>
        Your Existing Credentials for This Student
      </div>
      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0 }}>
        Made a mistake, or things changed since you issued one of these? Correct it below — the
        original stays visible, marked as replaced, never edited or deleted.
      </p>
      {error && (
        <div className="alert alert-danger" role="alert">
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{error}</span>
        </div>
      )}
      <div className="flex flex-col gap-8">
        {credentials.map((c) => {
          const meta = CRED_TYPE_META[c.credType] || {};
          const isCorrecting = correctingId === c.id;
          return (
            <div key={c.id} style={{ border: "1px solid var(--border-card)", borderRadius: "var(--radius-sm)", padding: "10px 12px" }}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-8">
                  <span className={`badge ${meta.badgeCls}`}>{meta.label}</span>
                  <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>#{c.id}</span>
                </span>
                {!isCorrecting && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => { setCorrectingId(c.id); setConfirming(false); setNewType(c.credType); }}
                  >
                    <PenLine size={13} /> Correct
                  </button>
                )}
              </div>
              {isCorrecting && (
                <div className="flex flex-col gap-8" style={{ marginTop: 10 }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label htmlFor={`correct-type-${c.id}`}>New Credential Type</label>
                    <select
                      id={`correct-type-${c.id}`}
                      value={newType}
                      onChange={(e) => { setNewType(e.target.value); setConfirming(false); }}
                    >
                      {CRED_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label htmlFor={`correct-reason-${c.id}`}>Reason (visible in the corrected record)</label>
                    <input
                      id={`correct-reason-${c.id}`}
                      type="text"
                      placeholder="e.g. Offer rescinded due to hiring freeze"
                      value={reason}
                      onChange={(e) => { setReason(e.target.value); setConfirming(false); }}
                    />
                  </div>
                  {confirming && (
                    <div className="alert alert-warning" role="alert" style={{ fontSize: "0.78rem" }}>
                      <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                      <span>
                        This permanently marks credential #{c.id} as corrected and publishes a new{" "}
                        <strong>{newType}</strong> record on-chain. It cannot be undone.
                      </span>
                    </div>
                  )}
                  <div className="flex gap-8">
                    <button
                      type="button"
                      className="btn btn-warning btn-sm"
                      disabled={submitting}
                      onClick={() => handleCorrect(c.id)}
                      style={{ flex: 1 }}
                    >
                      {submitting ? "Writing to the record…" : confirming ? <><CheckCircle2 size={14} /> Confirm Correction</> : "Submit Correction"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => { setCorrectingId(null); setConfirming(false); }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
