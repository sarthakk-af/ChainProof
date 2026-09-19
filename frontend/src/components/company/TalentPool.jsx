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

  const PAGE = 25;

  const query = useCallback((offset) => {
    const params = new URLSearchParams();
    if (filters.courseCode) params.set("courseCode", filters.courseCode);
    if (filters.batchYear) params.set("batchYear", filters.batchYear);
    if (filters.minCgpa) params.set("minCgpa", filters.minCgpa);
    if (filters.placed) params.set("placed", filters.placed);
    if (skills.length) params.set("skills", skills.join(","));
    params.set("limit", String(PAGE));
    params.set("offset", String(offset));
    return api.get(`/talent?${params.toString()}`);
  }, [filters, skills]);

  /**
   * Waits for the typing to stop before asking.
   *
   * The CGPA box fired a request per keystroke: typing "8.5" sent three, and
   * the answers could arrive out of order.
   */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      query(0)
        .then((r) => { if (!cancelled) setResult(r); })
        .catch((e) => { if (!cancelled) setError(e.message); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  /**
   * The backend answers 25 at a time. Without this the page showed 25 while
   * announcing "40 students match" — the other fifteen simply did not exist as
   * far as the reader could tell.
   */
  const [loadingMore, setLoadingMore] = useState(false);
  const showMore = () => {
    setLoadingMore(true);
    query(result.students.length)
      .then((r) => setResult((prev) => ({ ...r, students: [...prev.students, ...r.students] })))
      .catch((e) => setError(e.message))
      .finally(() => setLoadingMore(false));
  };

  // The way out of a search that found nothing. Without it the only move is to
  // undo four separate controls by hand.
  const clearFilters = () => {
    setFilters({ courseCode: "", batchYear: "", minCgpa: "", placed: "" });
    setSkills([]);
  };

  const toggleSkill = (skill) =>
    setSkills((current) =>
      current.includes(skill) ? current.filter((s) => s !== skill) : [...current, skill]
    );

  if (selected) {
    return <StudentDetail rollNumber={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="stack">
      <p className="form-hint" style={{ margin: 0 }}>
        <Users size={12} style={{ verticalAlign: "-2px" }} /> Students are shown without names or
        contact details. Those appear once a student applies to one of your drives.
      </p>

      {error && (
        <div className="alert alert-danger" role="alert">
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{error}</span>
        </div>
      )}

      <div className="split">
        <aside className="glass-card p-24 flex flex-col gap-12 side-sticky" aria-label="Filters">
          <h3 className="card-title">Filters</h3>
          <div className="form-group">
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

          <div className="form-grid cols-2">
            <div className="form-group">
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

            <div className="form-group">
              <label htmlFor="tp-cgpa">Min. CGPA</label>
              <input
                id="tp-cgpa"
                type="number" inputMode="decimal"
                step="0.1"
                min="0"
                max="10"
                value={filters.minCgpa}
                onChange={(e) => setFilters((f) => ({ ...f, minCgpa: e.target.value }))}
                placeholder="e.g. 7"
              />
            </div>
          </div>

          <div className="form-group">
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

          {facets.skills.length > 0 && (
            <div className="form-group">
              <span className="field-label" id="tp-skills-label">Skills</span>
              <p className="form-hint" style={{ margin: "0 0 4px" }}>
                Picking several shows students who have all of them.
              </p>
              <div className="flex gap-6" style={{ flexWrap: "wrap" }} role="group" aria-labelledby="tp-skills-label">
                {facets.skills.slice(0, 24).map((s) => (
                  <button
                    key={s.skill}
                    type="button"
                    className={skills.includes(s.skill) ? "pill pill-active" : "pill"}
                    aria-pressed={skills.includes(s.skill)}
                    onClick={() => toggleSkill(s.skill)}
                  >
                    {s.display} · {s.students}
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>

        <section>
          <div className="section-head">
            <div className="section-eyebrow">
              {loading
                ? "Searching…"
                : `${result.total} student${result.total === 1 ? "" : "s"} match`}
            </div>
            {/* The order is fixed and sensible, so say what it is rather than
                adding a control that only has one useful setting. */}
            {!loading && result.total > 1 && (
              <span className="row-meta">
                {result.students.length < result.total
                  ? `Showing ${result.students.length} · highest CGPA first`
                  : "Highest CGPA first"}
              </span>
            )}
          </div>

          {!loading && result.students.length === 0 ? (
            <div className="row-list">
              <div className="row-empty">
                <p style={{ marginBottom: "var(--space-3)" }}>No students match those filters.</p>
                <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>
                  Clear the filters
                </button>
              </div>
            </div>
          ) : (
            <div className="split-even" style={{ gap: "var(--space-3)" }}>
              {result.students.map((s) => (
                <button
                  key={s.rollNumber}
                  type="button"
                  className="glass-card student-card"
                  onClick={() => setSelected(s.rollNumber)}
                >
                  <div className="flex items-start justify-between gap-12">
                    <div style={{ minWidth: 0 }}>
                      <div className="flex items-center gap-8">
                        <span className="mono-addr">{s.rollNumber}</span>
                        {s.placed && <span className="pill pill-muted">Placed</span>}
                      </div>
                      <div className="row-meta" style={{ marginTop: 4 }}>
                        {s.courseCode} · Batch {s.batchYear}
                        {s.cgpa !== null && s.cgpa !== undefined && <> · CGPA {s.cgpa.toFixed(2)}</>}
                      </div>
                    </div>
                    <Lock size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} aria-label="Anonymous" />
                  </div>
                  {s.headline && <div className="student-card-headline">{s.headline}</div>}
                  {s.skills.length > 0 && (
                    <div className="flex gap-6" style={{ flexWrap: "wrap", marginTop: "var(--space-2)" }}>
                      {s.skills.slice(0, 6).map((skill) => (
                        <span key={skill} className="pill">{skill}</span>
                      ))}
                      {s.skills.length > 6 && <span className="pill pill-muted">+{s.skills.length - 6}</span>}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          {!loading && result.students.length < result.total && (
            <div className="flex justify-center" style={{ marginTop: "var(--space-4)" }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={showMore} disabled={loadingMore}>
                {loadingMore ? <span className="spinner" /> : `Show ${Math.min(PAGE, result.total - result.students.length)} more`}
              </button>
            </div>
          )}
        </section>
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
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
              {student.courseCode} · Batch {student.batchYear}
              {student.cgpa !== null && student.cgpa !== undefined && <> · CGPA {student.cgpa.toFixed(2)}</>}
              {student.placed && " · Already placed"}
            </div>
            {student.headline && <p style={{ marginTop: "var(--space-2)" }}>{student.headline}</p>}
            {student.about && (
              <p style={{ fontSize: "var(--text-sm)", whiteSpace: "pre-wrap", marginTop: "var(--space-2)", lineHeight: 1.6 }}>
                {student.about}
              </p>
            )}

            <div className="flex gap-12" style={{ flexWrap: "wrap", marginTop: "var(--space-3)", fontSize: "var(--text-sm)" }}>
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
              <strong style={{ fontSize: "var(--text-sm)" }}>Skills</strong>
              <div className="flex gap-8" style={{ flexWrap: "wrap", marginTop: "var(--space-2)" }}>
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
                <strong style={{ fontSize: "var(--text-sm)" }}>{label}</strong>
                <div className="flex flex-col gap-14" style={{ marginTop: "var(--space-2)" }}>
                  {items.map((item) => (
                    <div key={item.id}>
                      <div style={{ fontWeight: 600, fontSize: "var(--text-base)" }}>{item.title}</div>
                      {item.subtitle && (
                        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{item.subtitle}</div>
                      )}
                      {(item.startedOn || item.endedOn) && (
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                          {[item.startedOn, item.endedOn].filter(Boolean).join(" – ")}
                        </div>
                      )}
                      {item.description && (
                        <p style={{ fontSize: "var(--text-sm)", whiteSpace: "pre-wrap", marginTop: 4, lineHeight: 1.6 }}>
                          {item.description}
                        </p>
                      )}
                      {item.url && (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: "var(--text-xs)", display: "inline-flex", alignItems: "center", gap: 4, marginTop: 4 }}
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
      <div className="glass-card p-24" style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
        <Lock size={16} style={{ flexShrink: 0, marginTop: 2, color: "var(--text-muted)" }} />
        <div>
          <strong style={{ fontSize: "var(--text-sm)" }}>Contact details are hidden</strong>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: 4 }}>
            {student.contactUnlockedBy}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card p-24">
      <div className="flex items-center gap-8" style={{ marginBottom: "var(--space-2)" }}>
        <Unlock size={15} style={{ color: "var(--accent-success, #4ade80)" }} />
        <strong style={{ fontSize: "var(--text-sm)" }}>{student.contact.fullName}</strong>
      </div>
      <div className="flex gap-16" style={{ flexWrap: "wrap", fontSize: "var(--text-sm)" }}>
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
      <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: "var(--space-2)" }}>
        {student.contactUnlockedBy}
      </p>
    </div>
  );
}
