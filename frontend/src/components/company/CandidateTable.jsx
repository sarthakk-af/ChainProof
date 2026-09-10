import React from "react";
import { Users } from "lucide-react";
import { shortAddr } from "../../utils/format.js";
import { STAGE_BADGE } from "../../utils/credentialMeta.js";

function initials(name) {
  if (!name) return "?";
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

/**
 * CandidateTable.jsx — Company dashboard's candidate list, table form.
 *
 * A separate component from ../shared/StudentList.jsx (used by College)
 * rather than a shared one with a layout switch — a company juggling many
 * candidates across colleges benefits from a scannable table; a college
 * picking its own student to issue a credential to doesn't need the extra
 * columns. Same underlying data shape either way.
 */
export default function CandidateTable({ students, loading, activeAddress, onSelect }) {
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
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Candidate</th>
            <th>Latest Step</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {students.map((s) => (
            <tr key={s.address} style={activeAddress === s.address ? { background: "var(--bg-surface)" } : undefined}>
              <td>
                <span className="avatar-dot">{initials(s.name)}</span>
                {s.name || "Unnamed Student"}
                <div className="mono-addr" style={{ marginTop: 4, fontSize: "0.68rem", display: "inline-block" }}>
                  {shortAddr(s.address)}
                </div>
              </td>
              <td>
                {s.isPlaced && <span className="badge badge-success" style={{ marginRight: 6 }}>Placed</span>}
                {s.highestCredentialStage ? (
                  <span className={`badge ${STAGE_BADGE[s.highestCredentialStage] || "badge-none"}`}>
                    {s.highestCredentialStage}
                  </span>
                ) : (
                  <span className="badge badge-none">No Activity</span>
                )}
              </td>
              <td>
                <button type="button" onClick={() => onSelect(s)} style={{ background: "none", border: "none", color: "var(--accent-primary)", fontSize: "0.8rem", fontWeight: 500, cursor: "pointer", padding: 0 }}>
                  {activeAddress === s.address ? "Selected" : "Select →"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
