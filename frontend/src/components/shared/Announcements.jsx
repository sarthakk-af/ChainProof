/**
 * Announcements.jsx — the placement notice feed, shared by every dashboard.
 *
 * The only editable surface on this platform. Everything else a dashboard shows
 * is a chain record nobody can revise; a notice is ordinary text its author can
 * rewrite, and the interface says so — an edited notice carries "edited", and
 * the composer explains where the permanent record actually lives.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Megaphone, Pencil, Trash2, Globe, Users, AlertCircle, X } from "lucide-react";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../utils/api.js";
import { formatDate } from "../../utils/format.js";

/**
 * @param {Object} props
 * @param {"College"|"Company"|"Student"} props.role  What the signed-in account is.
 * @param {Array}  [props.drives]  The company's own drives, for the drive picker.
 */
export default function Announcements({ role, drives = [] }) {
  const { user } = useAuth();
  const address = user?.address;
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [composing, setComposing] = useState(false);

  const canPost = role === "College" || role === "Company";

  const load = useCallback(() => {
    setLoading(true);
    api
      .get("/announcements")
      .then((d) => setItems(d.announcements))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const remove = async (id) => {
    setError("");
    try {
      await api.del(`/announcements/${id}`);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="flex flex-col gap-16">
      {error && (
        <div className="alert alert-danger" role="alert">
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{error}</span>
        </div>
      )}

      {canPost && !composing && !editing && (
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setComposing(true)}>
          <Megaphone size={14} /> Post a notice
        </button>
      )}

      {(composing || editing) && (
        <NoticeComposer
          role={role}
          drives={drives}
          existing={editing}
          onCancel={() => {
            setComposing(false);
            setEditing(null);
          }}
          onSaved={() => {
            setComposing(false);
            setEditing(null);
            load();
          }}
          onError={setError}
        />
      )}

      {loading && <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Loading…</p>}

      {!loading && items.length === 0 && (
        <div className="glass-card p-24" style={{ textAlign: "center" }}>
          <Megaphone size={20} style={{ color: "var(--text-muted)", marginBottom: 8 }} />
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
            No placement notices yet.
          </p>
        </div>
      )}

      {items.map((item) => (
        <NoticeCard
          key={item.id}
          item={item}
          canManage={canPost && isOwn(item, address)}
          onEdit={() => setEditing(item)}
          onDelete={() => remove(item.id)}
        />
      ))}
    </div>
  );
}

/**
 * Whether the signed-in account wrote this notice.
 *
 * Compared by address rather than by role: two companies both see this feed,
 * and a role check would put an edit button on the other one's notice. The
 * backend is still the real gate — it scopes every edit and delete by author in
 * the same statement that performs it — so the worst a wrong answer here could
 * do is show a control that then refuses. Which is exactly why it should not be
 * wrong.
 */
function isOwn(item, address) {
  return !!address && item.authorAddress?.toLowerCase() === address.toLowerCase();
}

function NoticeCard({ item, canManage, onEdit, onDelete }) {
  return (
    <div className="glass-card p-24">
      <div className="flex items-start justify-between gap-12" style={{ marginBottom: 8 }}>
        <div>
          <strong style={{ fontFamily: "var(--font-head)", fontSize: "1rem" }}>{item.title}</strong>
          <div
            style={{
              fontSize: "0.75rem",
              color: "var(--text-muted)",
              marginTop: 4,
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span>{item.authorName || item.authorRole}</span>
            <span>·</span>
            <span>{formatDate(Math.floor(item.createdAt / 1000))}</span>
            {item.editedAt && (
              <>
                <span>·</span>
                {/* Said out loud rather than passed over: this is the one thing
                    on the platform that can change after publication. */}
                <span title={`Edited ${formatDate(Math.floor(item.editedAt / 1000))}`}>edited</span>
              </>
            )}
            <span className="pill pill-muted" style={{ fontSize: "0.68rem" }}>
              {item.audience === "public" ? <Globe size={10} /> : <Users size={10} />}
              {item.audience === "public" ? "Public" : "Students"}
            </span>
          </div>
        </div>

        {canManage && (
          <div className="flex gap-8" style={{ flexShrink: 0 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit} title="Edit">
              <Pencil size={14} />
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onDelete} title="Withdraw">
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>

      <p style={{ fontSize: "0.88rem", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{item.body}</p>

      {item.driveRoleTitle && (
        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 10 }}>
          About: {item.driveRoleTitle} (drive #{item.driveId})
        </p>
      )}
    </div>
  );
}

function NoticeComposer({ role, drives, existing, onCancel, onSaved, onError }) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [audience, setAudience] = useState(existing?.audience ?? "students");
  const [driveId, setDriveId] = useState(existing?.driveId ?? (drives[0]?.id ?? ""));
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    onError("");
    try {
      const payload = { title, body, audience };
      if (role === "Company" || driveId !== "") payload.driveId = Number(driveId);
      if (existing) await api.patch(`/announcements/${existing.id}`, payload);
      else await api.post("/announcements", payload);
      onSaved();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="glass-card p-24 flex flex-col gap-16">
      <div className="flex items-center justify-between">
        <strong style={{ fontFamily: "var(--font-head)" }}>
          {existing ? "Edit notice" : "New notice"}
        </strong>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          <X size={14} />
        </button>
      </div>

      <div className="form-group">
        <label htmlFor="an-title">Title</label>
        <input
          id="an-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Interview moved to Hall B"
          required
        />
      </div>

      <div className="form-group">
        <label htmlFor="an-body">Notice</label>
        <textarea
          id="an-body"
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What people need to know, and by when."
          required
        />
      </div>

      {role === "Company" && (
        <div className="form-group">
          <label htmlFor="an-drive">About which of your drives</label>
          <select id="an-drive" value={driveId} onChange={(e) => setDriveId(e.target.value)} required>
            <option value="">Select…</option>
            {drives.map((d) => (
              <option key={d.id} value={d.id}>
                #{d.id} · {d.roleTitle}
              </option>
            ))}
          </select>
        </div>
      )}

      {role === "College" && (
        <div className="form-group">
          <label htmlFor="an-audience">Who should see this</label>
          <select id="an-audience" value={audience} onChange={(e) => setAudience(e.target.value)}>
            <option value="students">Students and companies here</option>
            <option value="public">Everyone, including the public page</option>
          </select>
        </div>
      )}

      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
        Notices can be edited and withdrawn — they're announcements, not records. The
        drive, event or result a notice is about is already on the blockchain and can't be
        changed by anyone.
      </p>

      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? <span className="spinner" /> : existing ? "Save changes" : "Post"}
      </button>
    </form>
  );
}
