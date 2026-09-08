import React, { useState } from "react";
import { localRetrieve } from "../../utils/ipfsService.js";
import { CRED_TYPE_META, formatTimestamp } from "../../utils/credentialMeta.js";

export default function ProofGenerator({ credentials, visibility, studentAddress, studentName }) {
  const [proof, setProof] = useState(null);
  const [copied, setCopied] = useState(false);

  const generateProof = () => {
    const proofDoc = {
      schema: "chainproof-proof-v1",
      studentAddress,
      studentName,
      generatedAt: new Date().toISOString(),
      credentials: credentials
        .filter((c) => visibility[c.id] !== false)
        .map((c) => ({
          id: String(c.id),
          type: CRED_TYPE_META[c.credType]?.label,
          ipfsHash: c.ipfsHash,
          issuer: c.issuerAddress,
          issuedAt: formatTimestamp(c.timestamp),
          metadata: localRetrieve(c.ipfsHash),
        })),
      verificationNote:
        "Verify on-chain at the ActorRegistry/CredentialIssuer contract addresses. Credentials are immutable.",
    };
    setProof(JSON.stringify(proofDoc, null, 2));
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
        Generate a shareable JSON proof of your selected credentials. Toggle visibility
        switches on credentials you want to include or exclude.
      </p>
      <div className="alert alert-info" style={{ fontSize: "0.82rem" }}>
        <span>🔐</span>
        <span>
          Each credential's <code>ipfsHash</code> can be independently verified against the
          on-chain record. The blockchain timestamp is cryptographically immutable.
        </span>
      </div>

      <button
        id="generate-proof-btn"
        className="btn btn-secondary w-full"
        onClick={generateProof}
        disabled={credentials.length === 0}
      >
        🔑 Generate Proof JSON
      </button>

      {proof && (
        <div className="animate-fade-in-up flex flex-col gap-8">
          <div className="flex items-center justify-between">
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Proof Document</span>
            <button id="copy-proof-btn" className="btn btn-ghost btn-sm" onClick={copyProof}>
              {copied ? "✅ Copied!" : "📋 Copy"}
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
