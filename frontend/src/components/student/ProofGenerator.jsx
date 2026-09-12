import React, { useState } from "react";
import { ShieldCheck, KeyRound, Copy, Check, AlertTriangle } from "lucide-react";
import { localRetrieve } from "../../utils/ipfsService.js";
import { DEPLOYMENT } from "../../contracts/deployment.js";
import { CRED_TYPE_META, formatTimestamp } from "../../utils/credentialMeta.js";
import { buildProofDocument } from "../../utils/proofDocument.js";

export default function ProofGenerator({ credentials, visibility, studentAddress, studentName }) {
  const [proof, setProof] = useState(null);
  const [forcedCount, setForcedCount] = useState(0);
  const [copied, setCopied] = useState(false);

  const generateProof = () => {
    // The document logic lives in utils/proofDocument.js, with no imports, so
    // its tests exercise the real function instead of a copy of it.
    const doc = buildProofDocument({
      credentials,
      visibility,
      studentAddress,
      studentName,
      deployment: DEPLOYMENT,
      lookupMetadata: localRetrieve,
      labelFor: (credType) => CRED_TYPE_META[credType]?.label,
      formatTime: formatTimestamp,
    });
    setForcedCount(doc.credentials.filter((c) => c.includedAutomatically).length);
    setProof(JSON.stringify(doc, null, 2));
  };

  const copyProof = () => {
    if (!proof) return;
    navigator.clipboard.writeText(proof);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="glass-card p-24 flex flex-col gap-16">
      <p style={{ fontSize: "0.88rem", margin: 0 }}>
        Generate a shareable proof of your selected credentials. Use the visibility
        toggles to choose what to include.
      </p>
      <div className="alert alert-info" style={{ fontSize: "0.82rem" }}>
        <ShieldCheck size={16} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>
          The proof tells a recruiter exactly how to check each credential against the
          blockchain and IPFS themselves. You can leave credentials out — but if you
          include one that was later corrected, the correction comes with it.
        </span>
      </div>

      <button
        id="generate-proof-btn"
        className="btn btn-secondary w-full"
        onClick={generateProof}
        disabled={credentials.length === 0}
      >
        <KeyRound size={16} /> Generate Proof
      </button>

      {proof && (
        <div className="animate-fade-in-up flex flex-col gap-8">
          {forcedCount > 0 && (
            <div className="alert alert-warning" style={{ fontSize: "0.82rem" }} role="status">
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                {forcedCount === 1
                  ? "A correction was added automatically, because it applies to a credential you included."
                  : forcedCount +
                    " corrections were added automatically, because they apply to credentials you included."}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Proof Document</span>
            <button id="copy-proof-btn" className="btn btn-ghost btn-sm" onClick={copyProof}>
              {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
            </button>
          </div>
          <textarea
            readOnly
            value={proof}
            style={{ height: 280, fontFamily: "var(--font-mono)", fontSize: "0.72rem", resize: "none" }}
          />
        </div>
      )}
    </div>
  );
}
