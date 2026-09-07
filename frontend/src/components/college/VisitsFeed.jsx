import React from "react";

export default function VisitsFeed({ visits, loading }) {
  if (loading) {
    return (
      <div className="flex justify-center" style={{ padding: 24 }}>
        <div className="spinner" />
      </div>
    );
  }

  if (visits.length === 0) {
    return (
      <div className="empty-state" style={{ padding: "32px 16px" }}>
        <div className="empty-state-icon" style={{ fontSize: "2rem" }}>📅</div>
        <p style={{ fontSize: "0.85rem" }}>No announcements published yet.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-12">
      {visits.map((v) => (
        <div key={v.id} className="glass-card animate-fade-in-up" style={{ padding: "14px 18px" }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
            <strong style={{ fontFamily: "var(--font-head)" }}>{v.companyName}</strong>
            <span className="badge badge-company">
              {new Date(v.visitDate * 1000).toLocaleDateString("en-IN")}
            </span>
          </div>
          <span className="mono-addr" title={v.ipfsHash} style={{ fontSize: "0.7rem" }}>
            IPFS: {v.ipfsHash.slice(0, 24)}…
          </span>
        </div>
      ))}
    </div>
  );
}
