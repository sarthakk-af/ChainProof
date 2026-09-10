import React from "react";
import { CalendarDays } from "lucide-react";
import { formatDate, formatTimestamp } from "../../utils/format.js";

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
        <CalendarDays size={32} className="empty-state-icon" />
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
              {formatDate(v.visitDate)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="mono-addr" title={v.ipfsHash} style={{ fontSize: "0.7rem" }}>
              IPFS: {v.ipfsHash.slice(0, 24)}…
            </span>
            <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
              Recorded on-chain {formatTimestamp(v.timestamp)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
