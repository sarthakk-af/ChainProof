/**
 * ClassmateLookup.jsx — finding another student.
 *
 * Takes a roll number **and** an email, both matching the same person. That
 * pair is not much of a secret — college emails are often derivable from roll
 * numbers — and the screen does not pretend otherwise. It is a lookup key, not
 * a password: you can open the profile of someone you already know, and you
 * cannot walk the batch one number at a time, because the backend rate-limits
 * these to twenty in fifteen minutes.
 */

import React, { useState } from "react";
import { Search, AlertCircle, ExternalLink, Mail, Tag } from "lucide-react";
import { api } from "../../utils/api.js";

export default function ClassmateLookup() {
  const [rollNumber, setRollNumber] = useState("");
  const [email, setEmail] = useState("");
  const [student, setStudent] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setStudent(null);
    try {
      const result = await api.post("/students/lookup", {
        rollNumber: rollNumber.trim().toUpperCase(),
        email: email.trim(),
      });
      setStudent(result.student);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-20">
      <form onSubmit={submit} className="glass-card p-24 flex flex-col gap-16">
        <div>
          <h3 className="card-title">Find a classmate</h3>
          <p className="card-lead">
            You need both their roll number and the email they signed up with. There is no
            browsable list of students here — only companies see the pool, and they see it
            without names.
          </p>
        </div>

        <div className="flex gap-12" style={{ flexWrap: "wrap" }}>
          <div className="form-group" style={{ flex: "1 1 160px" }}>
            <label htmlFor="cl-roll">Roll number</label>
            <input
              id="cl-roll"
              value={rollNumber}
              onChange={(e) => setRollNumber(e.target.value.toUpperCase())}
              placeholder="21CE1042"
              required
            />
          </div>
          <div className="form-group" style={{ flex: "2 1 220px" }}>
            <label htmlFor="cl-email">Email</label>
            <input
              id="cl-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="them@college.edu"
              required
            />
          </div>
        </div>

        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? <span className="spinner" /> : <><Search size={14} /> Look up</>}
        </button>
      </form>

      {error && (
        <div className="alert alert-danger" role="alert">
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{error}</span>
        </div>
      )}

      {student && <StudentCard student={student} />}
    </div>
  );
}

function StudentCard({ student }) {
  const sections = [
    ["experience", "Internships & experience"],
    ["project", "Projects"],
    ["education", "Education"],
    ["certification", "Certifications"],
    ["achievement", "Achievements"],
  ];

  return (
    <div className="glass-card p-24">
      <h3 style={{ marginBottom: 2 }}>{student.fullName}</h3>
      <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginBottom: 4 }}>
        <span className="mono-addr">{student.rollNumber}</span> · {student.courseCode} · Batch{" "}
        {student.batchYear}
        {student.cgpa !== null && student.cgpa !== undefined && <> · CGPA {student.cgpa.toFixed(2)}</>}
      </div>
      {student.headline && <p style={{ fontSize: "var(--text-base)", marginTop: "var(--space-2)" }}>{student.headline}</p>}

      <div className="flex gap-12" style={{ flexWrap: "wrap", marginTop: "var(--space-2)", fontSize: "var(--text-sm)" }}>
        <a href={`mailto:${student.email}`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <Mail size={12} /> {student.email}
        </a>
        {["github", "linkedin", "portfolio"].map((key) => {
          const url = student[`${key}Url`];
          return url ? (
            <a
              key={key}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              <ExternalLink size={12} /> {key}
            </a>
          ) : null;
        })}
      </div>

      {student.about && (
        <p style={{ fontSize: "var(--text-sm)", whiteSpace: "pre-wrap", marginTop: "var(--space-3)", lineHeight: 1.6 }}>
          {student.about}
        </p>
      )}

      {student.skills?.length > 0 && (
        <div style={{ marginTop: "var(--space-4)" }}>
          <div className="flex items-center gap-6" style={{ marginBottom: "var(--space-2)" }}>
            <Tag size={13} />
            <strong style={{ fontSize: "var(--text-sm)" }}>Skills</strong>
          </div>
          <div className="flex gap-8" style={{ flexWrap: "wrap" }}>
            {student.skills.map((s) => (
              <span key={s} className="pill">{s}</span>
            ))}
          </div>
        </div>
      )}

      {sections.map(([key, label]) => {
        const items = student.resume?.[key] ?? [];
        if (items.length === 0) return null;
        return (
          <div key={key} style={{ marginTop: "var(--space-4)" }}>
            <strong style={{ fontSize: "var(--text-sm)" }}>{label}</strong>
            <div className="flex flex-col gap-10" style={{ marginTop: "var(--space-2)" }}>
              {items.map((item) => (
                <div key={item.id}>
                  <div style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>{item.title}</div>
                  {item.subtitle && (
                    <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{item.subtitle}</div>
                  )}
                  {item.description && (
                    <p style={{ fontSize: "var(--text-sm)", whiteSpace: "pre-wrap", marginTop: 4 }}>
                      {item.description}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
