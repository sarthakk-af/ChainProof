/**
 * ResumeEditor.jsx — where a student writes the half of their profile that is
 * theirs to write.
 *
 * Nothing here is verified by anyone, and the interface says so plainly rather
 * than implying a check that does not happen. What the platform vouches for is
 * the placement record — who came, who was offered, who accepted — and that is
 * written by whoever would be embarrassed by the lie. A resume is a claim, and
 * a false one surfaces at the interview.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, X, ExternalLink, Tag } from "lucide-react";
import { api } from "../../utils/api.js";

export default function ResumeEditor({ onError, onNotice }) {
  const [sections, setSections] = useState([]);
  const [resume, setResume] = useState({});
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(null); // section key
  const [editing, setEditing] = useState(null); // item

  const load = useCallback(() => {
    Promise.all([api.get("/me/resume-sections"), api.get("/me/resume")])
      .then(([s, r]) => {
        setSections(s.sections);
        setResume(r.resume);
        setSkills(r.skills);
      })
      .catch((e) => onError(e.message))
      .finally(() => setLoading(false));
  }, [onError]);

  useEffect(load, [load]);

  const [removing, setRemoving] = useState(null);
  const remove = async (id) => {
    if (removing) return;
    onError("");
    setRemoving(id);
    try {
      await api.del(`/me/resume/item/${id}`);
      load();
    } catch (err) {
      onError(err.message);
    } finally {
      setRemoving(null);
    }
  };

  if (loading) return <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Loading…</p>;

  return (
    <div className="stack">
      <p className="form-hint" style={{ margin: 0 }}>
        Companies see this with your roll number, course, batch and CGPA — not your name,
        email or phone, which appear only to a company whose drive you applied to.
      </p>

      <SkillsPanel skills={skills} onSaved={(s) => { setSkills(s); onNotice("Skills saved."); }} onError={onError} />

      <div className="split-even">
      {sections.map((section) => {
        const items = resume[section.key] ?? [];
        return (
          <div key={section.key} className="glass-card p-24">
            <div className="flex items-start justify-between gap-12" style={{ marginBottom: 10 }}>
              <div>
                <h3 className="card-title">{section.label}</h3>
                <p className="card-lead">
                  {section.help}
                </p>
              </div>
              {adding !== section.key && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => { setAdding(section.key); setEditing(null); }}
                >
                  <Plus size={14} /> Add
                </button>
              )}
            </div>

            {adding === section.key && (
              <ItemForm
                section={section}
                onCancel={() => setAdding(null)}
                onSaved={() => { setAdding(null); load(); onNotice("Added."); }}
                onError={onError}
              />
            )}

            {items.length === 0 && adding !== section.key && (
              <p className="form-hint" style={{ margin: 0 }}>Nothing added yet.</p>
            )}

            <div className="flex flex-col gap-12">
              {items.map((item) =>
                editing?.id === item.id ? (
                  <ItemForm
                    key={item.id}
                    section={section}
                    existing={item}
                    onCancel={() => setEditing(null)}
                    onSaved={() => { setEditing(null); load(); onNotice("Saved."); }}
                    onError={onError}
                  />
                ) : (
                  <ItemRow
                    key={item.id}
                    item={item}
                    onEdit={() => { setEditing(item); setAdding(null); }}
                    onDelete={() => remove(item.id)}
                    deleting={removing === item.id}
                  />
                )
              )}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ItemRow({ item, onEdit, onDelete, deleting }) {
  const period = [item.startedOn, item.endedOn].filter(Boolean).join(" – ");
  return (
    <div
      style={{
        borderLeft: "2px solid var(--border-subtle, rgba(255,255,255,0.12))",
        paddingLeft: 14,
      }}
    >
      <div className="flex items-start justify-between gap-12">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: "0.92rem" }}>{item.title}</div>
          {item.subtitle && (
            <div style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>{item.subtitle}</div>
          )}
          {period && (
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 2 }}>{period}</div>
          )}
        </div>
        <div className="flex gap-8" style={{ flexShrink: 0 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit} title="Edit" aria-label="Edit">
            <Pencil size={14} />
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onDelete} title="Remove" aria-label="Remove" disabled={deleting}>
            {deleting ? <span className="spinner" /> : <Trash2 size={14} />}
          </button>
        </div>
      </div>

      {item.description && (
        <p style={{ fontSize: "0.84rem", whiteSpace: "pre-wrap", marginTop: 6, lineHeight: 1.6 }}>
          {item.description}
        </p>
      )}
      {item.url && (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: "0.78rem", display: "inline-flex", alignItems: "center", gap: 4, marginTop: 6 }}
        >
          <ExternalLink size={12} /> {item.url.replace(/^https?:\/\//, "").slice(0, 48)}
        </a>
      )}
    </div>
  );
}

function ItemForm({ section, existing, onCancel, onSaved, onError }) {
  const [values, setValues] = useState({
    title: existing?.title ?? "",
    subtitle: existing?.subtitle ?? "",
    startedOn: existing?.startedOn ?? "",
    endedOn: existing?.endedOn ?? "",
    description: existing?.description ?? "",
    url: existing?.url ?? "",
  });
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    onError("");
    try {
      if (existing) await api.patch(`/me/resume/item/${existing.id}`, values);
      else await api.post(`/me/resume/${section.key}`, values);
      onSaved();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-12" style={{ marginBottom: 16 }}>
      <div className="flex items-center justify-between">
        <strong style={{ fontSize: "0.85rem" }}>{existing ? "Edit entry" : `Add to ${section.label}`}</strong>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          <X size={13} />
        </button>
      </div>

      <div className="form-group">
        <label htmlFor="ri-title">{section.titleLabel}</label>
        <input id="ri-title" value={values.title} onChange={set("title")} required />
      </div>

      <div className="form-group">
        <label htmlFor="ri-subtitle">
          {section.subtitleLabel} <span className="label-optional">(optional)</span>
        </label>
        <input id="ri-subtitle" value={values.subtitle} onChange={set("subtitle")} />
      </div>

      <div className="flex gap-12" style={{ flexWrap: "wrap" }}>
        <div className="form-group" style={{ flex: "1 1 140px" }}>
          <label htmlFor="ri-start">From</label>
          <input id="ri-start" value={values.startedOn} onChange={set("startedOn")} placeholder="Jun 2025" />
        </div>
        <div className="form-group" style={{ flex: "1 1 140px" }}>
          <label htmlFor="ri-end">To</label>
          <input id="ri-end" value={values.endedOn} onChange={set("endedOn")} placeholder="Aug 2025 or Present" />
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="ri-desc">
          Description <span className="label-optional">(optional)</span>
        </label>
        <textarea id="ri-desc" rows={3} value={values.description} onChange={set("description")} />
      </div>

      <div className="form-group">
        <label htmlFor="ri-url">
          Link <span className="label-optional">(optional)</span>
        </label>
        <input id="ri-url" value={values.url} onChange={set("url")} placeholder="https://…" />
      </div>

      <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
        {busy ? <span className="spinner" /> : "Save"}
      </button>
    </form>
  );
}

/**
 * Skills, edited as one list.
 *
 * The one part of a resume a company filters on, which is why it is a list of
 * tags rather than a free-text field: "React.js" and "react js" have to be the
 * same thing to a search, and the backend normalises them to one key.
 */
function SkillsPanel({ skills, onSaved, onError }) {
  const [items, setItems] = useState(skills);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const add = () => {
    const value = draft.trim();
    if (!value) return;
    if (!items.some((s) => s.toLowerCase() === value.toLowerCase())) {
      setItems([...items, value]);
      setDirty(true);
    }
    setDraft("");
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    onError("");
    try {
      const result = await api.put("/me/skills", { skills: items });
      setItems(result.skills);
      setDirty(false);
      onSaved(result.skills);
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass-card p-24">
      <div className="flex items-center gap-8" style={{ marginBottom: 10 }}>
        <Tag size={15} />
        <h3 className="card-title">Skills</h3>
      </div>
      <p className="card-lead" style={{ marginBottom: 12 }}>
        These are what a company filters on when it looks at this college.
      </p>

      <div className="flex gap-8" style={{ flexWrap: "wrap", marginBottom: 14 }}>
        {items.map((skill) => (
          <span key={skill} className="pill" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {skill}
            <button
              type="button"
              onClick={() => { setItems(items.filter((s) => s !== skill)); setDirty(true); }}
              style={{ background: "none", border: 0, cursor: "pointer", color: "inherit", padding: 0, lineHeight: 1 }}
              aria-label={`Remove ${skill}`}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        {items.length === 0 && (
          <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>None yet.</span>
        )}
      </div>

      <div className="flex gap-8" style={{ flexWrap: "wrap" }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="e.g. PostgreSQL"
          style={{ flex: "1 1 180px" }}
        />
        <button type="button" className="btn btn-ghost btn-sm" onClick={add}>
          <Plus size={14} /> Add
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy || !dirty}>
          {busy ? <span className="spinner" /> : "Save skills"}
        </button>
      </div>
    </div>
  );
}
