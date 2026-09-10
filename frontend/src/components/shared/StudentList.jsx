import React from "react";
import { Users } from "lucide-react";
import { shortAddr } from "../../utils/format.js";
import { STAGE_BADGE } from "../../utils/credentialMeta.js";

export default function StudentList({ students, loading, activeAddress, onSelect }) {
  if (loading) {
    return (
      <div className="flex justify-center" style={{ padding: 40 }}>
        <div className="spinner" />
      </div>
    );
  }

  if (students.length === 0) {
    return (
      <div className="empty-state glass-card">
        <Users size={48} className="empty-state-icon" />
        <h3>No Students Found</h3>
        <p style={{ fontSize: "0.85rem" }}>
          No students have registered yet. Try refreshing after a student registers.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      {students.map((s) => (
        <div
          key={s.address}
          id={`student-row-${s.address.slice(2, 8)}`}
          className="glass-card animate-fade-in-up"
          role="button"
          aria-pressed={activeAddress === s.address}
          tabIndex={0}
          style={{
            padding: "14px 18px",
            border: activeAddress === s.address ? "1px solid var(--accent-primary)" : "1px solid var(--border-card)",
            cursor: "pointer",
          }}
          onClick={() => onSelect(s)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(s);
            }
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <strong style={{ fontFamily: "var(--font-head)", fontSize: "0.95rem" }}>
                {s.name || "Unnamed Student"}
              </strong>
              <div className="mono-addr" style={{ marginTop: 4, fontSize: "0.72rem" }}>
                {shortAddr(s.address)}
              </div>
            </div>
            <div className="flex items-center gap-8">
              {s.isPlaced && <span className="badge badge-success">Placed</span>}
              {s.highestCredentialStage && (
                <span className={`badge ${STAGE_BADGE[s.highestCredentialStage] || "badge-none"}`}>
                  {s.highestCredentialStage}
                </span>
              )}
              {!s.highestCredentialStage && <span className="badge badge-none">No Activity</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
