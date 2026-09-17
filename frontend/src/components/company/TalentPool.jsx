/**
 * TalentPool.jsx — what a recruiter can see of this college's students.
 *
 * Anonymous by design: roll number, course, batch, CGPA, skills and everything
 * a student wrote about their work — no name, no email, no phone. The screen
 * says so rather than leaving a recruiter to wonder whether the data is
 * missing, because the rule is the interesting part: contact details appear for
 * one student at the moment that student applies to one of your drives.
 *
 * Which means there is no cold outreach here at all. You post a drive, the
 * college hosts it, students apply. That is what keeps the college in the
 * middle and the placement record complete.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  Users,
  Search,
  AlertCircle,
  Lock,
  Unlock,
  ExternalLink,
  ArrowLeft,
  Mail,
  Phone,
} from "lucide-react";
import { api } from "../../utils/api.js";

export default function TalentPool() {
  const [facets, setFacets] = useState({ courses: [], batches: [], skills: [] });
  const [filters, setFilters] = useState({ courseCode: "", batchYear: "", minCgpa: "", placed: "" });
  const [skills, setSkills] = useState([]);
  const [result, setResult] = useState({ students: [], total: 0 });
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/talent/facets").then(setFacets).catch((e) => setError(e.message));
  }, []);

  const search = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.courseCode) params.set("courseCode", filters.courseCode);
    if (filters.batchYear) params.set("batchYear", filters.batchYear);
    if (filters.minCgpa) params.set("minCgpa", filters.minCgpa);
    if (filters.placed) params.set("placed", filters.placed);
    if (skills.length) params.set("skills", skills.join(","));

    api
      .get(`/talent?${params.toString()}`)
      .then(setResult)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [filters, skills]);

  useEffect(search, [search]);

  const toggleSkill = (skill) =>
    setSkills((current) =>
      current.includes(skill) ? current.filter((s) => s !== skill) : [...current, skill]
    );

  if (selected) {
    return <StudentDetail rollNumber={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="flex flex-col gap-20">
      <div className="glass-card p-24">
        <div className="flex items-center gap-8" style={{ marginBottom: 6 }}>
          <Users size={16} />
          <strong style={{ fontFamily: "var(--font-head)" }}>Students at this college</strong>
        </div>
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
          Profiles are shown without names or contact details. A student's name, email and
          phone appear to you once they apply to one of your drives — applying is how they
          agree to be contacted.
        </p>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{error}</span>
        </div>
      )}

      <div className="glass-card p-24 flex flex-col gap-16">
        <div className="flex gap-12" style={{ flexWrap: "wrap" }}>
          <div className="form-group" style={{ flex: "1 1 140px" }}>
            <label htmlFor="tp-course">Course</label>
            <select
              id="tp-course"
              value={filters.courseCode}
              onChange={(e) => setFilters((f) => ({ ...f, courseCode: e.target.value }))}
            >
              <option value="">Any</option>
              {facets.courses.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} ({c.students})
                </option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ flex: "1 1 120px" }}>
            <label htmlFor="tp-batch">Batch</label>
            <select
              id="tp-batch"
              value={filters.batchYear}
              onChange={(e) => setFilters((f) => ({ ...f, batchYear: e.target.value }))}
            >
              <option value="">Any</option>
              {facets.batches.map((b) => (
                <option key={b.year} value={b.year}>
                  {b.year} ({b.students})
                </option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ flex: "1 1 120px" }}>
            <label htmlFor="tp-cgpa">Minimum CGPA</label>
            <input
              id="tp-cgpa"
              type="number"
              step="0.1"
              min="0"
              max="10"
              value={filters.minCgpa}
              onChange={(e) => setFilters((f) => ({ ...f, minCgpa: e.target.value }))}
              placeholder="e.g. 7"
            />
          </div>

          <div className="form-group" style={{ flex: "1 1 140px" }}>
            <label htmlFor="tp-placed">Availability</label>
            <select
              id="tp-placed"
              value={filters.placed}
              onChange={(e) => setFilters((f) => ({ ...f, placed: e.target.value }))}
            >
              <option value="">Everyone</option>
              <option value="false">Not yet placed</option>
              <option value="true">Already placed</option>
            </select>
          </div>
        </div>

        {facets.skills.length > 0 && (
          <div>
            <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>Skills</label>
            <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", margin: "2px 0 8px" }}>
              Picking more than one narrows to students who have all of them.
            </p>
            <div className="flex gap-8" style={{ flexWrap: "wrap" }}>
              {facets.skills.slice(0, 24).map((s) => (
                <button
                  key={s.skill}
                  type="button"
                  className={skills.includes(s.skill) ? "pill pill-active" : "pill"}
                  onClick={() => toggleSkill(s.skill)}
                  style={{ cursor: "pointer" }}
                >
                  {s.display} · {s.students}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
        {loading ? "Searching…" : `${result.total} student${result.total === 1 ? "" : "s"} match`}
      </div>

      <div className="flex flex-col gap-12">
        {result.students.map((s) => (
          <button
            key={s.rollNumber}
            type="button"
            className="glass-card p-24"
            onClick={() => setSelected(s.rollNumber)}
            style={{ textAlign: "left", cursor: "pointer", width: "100%" }}
          >
            <div className="flex items-start justify-between gap-12" style={{ flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>
                  <span className="mono-addr">{s.rollNumber}</span>
                  {s.placed && (
                    <span className="pill pill-muted" style={{ marginLeft: 8, fontSize: "0.68rem" }}>
                      Placed
                    </span>
                  )}
                </div>
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 2 }}>
                  {s.courseCode} · Batch {s.batchYear}
                  {s.cgpa !== null && s.cgpa !== undefined && <> · CGPA {s.cgpa.toFixed(2)}</>}
                </div>
                {s.headline && <div style={{ fontSize: "0.85rem", marginTop: 6 }}>{s.headline}</div>}
              </div>
              <Lock size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} title="Anonymous" />
            </div>

            {s.skills.length > 0 && (
              <div className="flex gap-8" style={{ flexWrap: "wrap", marginTop: 10 }}>
                {s.skills.slice(0, 8).map((skill) => (
                  <span key={skill} className="pill" style={{ fontSize: "0.7rem" }}>
                    {skill}
                  </span>
                ))}
              </div>
            )}
          </button>
        ))}

        {!loading && result.students.length === 0 && (
          <div className="glass-card p-24" style={{ textAlign: "center" }}>
            <Search size={20} style={{ color: "var(--text-muted)", marginBottom: 8 }} />
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
              No students match those filters.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function StudentDetail({ rollNumber, onBack }) {
  const [student, setStudent] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get(`/talent/${encodeURIComponent(rollNumber)}`)
      .then((d) => setStudent(d.student))
      .catch((e) => setError(e.message));
  }, [rollNumber]);

  const sections = [
    ["experience", "Internships & experience"],
    ["project", "Projects"],
    ["education", "Education"],
    ["certification", "Certifications"],
    ["achievement", "Achievements"],
  ];

  return (
    <div className="flex flex-col gap-20">
      <button type="button" className="btn btn-ghost btn-sm" onClick={onBack} style={{ alignSelf: "flex-start" }}>
        <ArrowLeft size={14} /> Back to all students
      </button>

      {error && (
        <div className="alert alert-danger" role="alert">
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{error}</span>
        </div>
      )}

      {student && (
        <>
          <div className="glass-card p-24">
            <h3 style={{ marginBottom: 2 }}>
              <span className="mono-addr">{student.rollNumber}</span>
            </h3>
            <div style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
              {student.courseCode} · Batch {student.batchYear}
              {student.cgpa !== null && student.cgpa !== undefined && <> · CGPA {student.cgpa.toFixed(2)}</>}
              {student.placed && " · Already placed"}
            </div>
            {student.headline && <p style={{ marginTop: 10 }}>{student.headline}</p>}
            {student.about && (
              <p style={{ fontSize: "0.86rem", whiteSpace: "pre-wrap", marginTop: 10, lineHeight: 1.6 }}>
                {student.about}
              </p>
            )}

            <div className="flex gap-12" style={{ flexWrap: "wrap", marginTop: 12, fontSize: "0.8rem" }}>
              {Object.entries(student.links || {}).map(([key, url]) =>
                url ? (
                  <a
                    key={key}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                  >
                    <ExternalLink size={12} /> {key}
                  </a>
                ) : null
              )}
            </div>
          </div>

          <ContactPanel student={student} />

          {student.skills?.length > 0 && (
            <div className="glass-card p-24">
              <strong style={{ fontSize: "0.85rem" }}>Skills</strong>
              <div className="flex gap-8" style={{ flexWrap: "wrap", marginTop: 10 }}>
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
              <div key={key} className="glass-card p-24">
                <strong style={{ fontSize: "0.85rem" }}>{label}</strong>
                <div className="flex flex-col gap-14" style={{ marginTop: 10 }}>
                  {items.map((item) => (
                    <div key={item.id}>
                      <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{item.title}</div>
                      {item.subtitle && (
                        <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{item.subtitle}</div>
                      )}
                      {(item.startedOn || item.endedOn) && (
                        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                          {[item.startedOn, item.endedOn].filter(Boolean).join(" – ")}
                        </div>
                      )}
                      {item.description && (
                        <p style={{ fontSize: "0.84rem", whiteSpace: "pre-wrap", marginTop: 4, lineHeight: 1.6 }}>
                          {item.description}
                        </p>
                      )}
                      {item.url && (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: "0.78rem", display: "inline-flex", alignItems: "center", gap: 4, marginTop: 4 }}
                        >
                          <ExternalLink size={12} /> link
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

/**
 * Contact details, or the reason there aren't any.
 *
 * Shown as a locked panel rather than simply omitted, because a recruiter
 * looking at a profile with no phone number should understand the rule instead
 * of assuming the student left it blank.
 */
function ContactPanel({ student }) {
  if (!student.contactUnlocked) {
    return (
      <div className="glass-card p-24" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <Lock size={16} style={{ flexShrink: 0, marginTop: 2, color: "var(--text-muted)" }} />
        <div>
          <strong style={{ fontSize: "0.88rem" }}>Contact details are hidden</strong>
          <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginTop: 4 }}>
            {student.contactUnlockedBy}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card p-24">
      <div className="flex items-center gap-8" style={{ marginBottom: 8 }}>
        <Unlock size={15} style={{ color: "var(--accent-success, #4ade80)" }} />
        <strong style={{ fontSize: "0.88rem" }}>{student.contact.fullName}</strong>
      </div>
      <div className="flex gap-16" style={{ flexWrap: "wrap", fontSize: "0.84rem" }}>
        {student.contact.email && (
          <a href={`mailto:${student.contact.email}`} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Mail size={13} /> {student.contact.email}
          </a>
        )}
        {student.contact.phone && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Phone size={13} /> {student.contact.phone}
          </span>
        )}
      </div>
      <p style={{ fontSize: "0.74rem", color: "var(--text-muted)", marginTop: 10 }}>
        {student.contactUnlockedBy}
      </p>
    </div>
  );
}
