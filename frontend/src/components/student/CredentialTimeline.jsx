import React from "react";
import { Inbox, AlertTriangle, CornerDownRight } from "lucide-react";
import { localRetrieve } from "../../utils/ipfsService.js";
import { CRED_TYPE_META, formatTimestamp } from "../../utils/credentialMeta.js";
import { shortAddr } from "../../utils/format.js";

export default function CredentialTimeline({ credentials, visibility, onToggleVisibility }) {
  if (credentials.length === 0) {
    return (
      <div className="empty-state glass-card">
        <Inbox size={48} className="empty-state-icon" />
        <h3>No Credentials Yet</h3>
        <p style={{ fontSize: "0.85rem" }}>
          Your placement credentials will appear here once a College or Company issues them.
        </p>
      </div>
    );
  }

  return (
    <div className="timeline">
      {credentials.map((cred) => {
        const meta = CRED_TYPE_META[cred.credType] || {};
        const hidden = visibility[cred.id] === false;
        const ipfsMeta = localRetrieve(cred.ipfsHash);

        return (
          <div key={cred.id} className={`timeline-item ${meta.cls || ""}`}>
            <div className="timeline-dot" />
            <div
              className="glass-card"
              style={{
                padding: "16px 20px",
                opacity: cred.superseded ? 0.55 : hidden ? 0.45 : 1,
                transition: "var(--transition)",
              }}
            >
              {/* Header row */}
              <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                <div className="flex items-center gap-8">
                  <span
                    className={`badge ${meta.badgeCls}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      textDecoration: cred.superseded ? "line-through" : undefined,
                    }}
                  >
                    {meta.Icon && <meta.Icon size={12} />}
                    {meta.label}
                  </span>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>#{cred.id}</span>
                  {cred.superseded && (
                    <span
                      className="badge badge-warning"
                      style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                      title="A newer record replaces this one"
                    >
                      <AlertTriangle size={12} /> Corrected
                    </span>
                  )}
                  {cred.isCorrection && (
                    <span
                      className="badge badge-none"
                      style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                      title={`Replaces credential #${cred.supersedesId}`}
                    >
                      <CornerDownRight size={12} /> corrects #{cred.supersedesId}
                    </span>
                  )}
                </div>
                {/* Visibility toggle */}
                <label className="toggle-switch" title="Toggle credential visibility in proof">
                  <input
                    type="checkbox"
                    checked={visibility[cred.id] !== false}
                    onChange={() => onToggleVisibility(cred.id)}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>

              {/* Content */}
              <div className="flex flex-col gap-4">
                {ipfsMeta?.title && <strong style={{ fontSize: "0.95rem" }}>{ipfsMeta.title}</strong>}
                {ipfsMeta?.description && (
                  <p style={{ fontSize: "0.83rem", margin: 0 }}>{ipfsMeta.description}</p>
                )}
                <div className="flex gap-16" style={{ marginTop: 6 }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    Issued by: <span className="mono-addr">{shortAddr(cred.issuerAddress)}</span>
                  </span>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    {formatTimestamp(cred.timestamp)}
                  </span>
                </div>
                <div className="flex items-center gap-8" style={{ marginTop: 2 }}>
                  <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>IPFS:</span>
                  <span
                    className="mono-addr"
                    title={cred.ipfsHash}
                    style={{ fontSize: "0.7rem", maxWidth: 180 }}
                  >
                    {cred.ipfsHash.slice(0, 20)}…
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
