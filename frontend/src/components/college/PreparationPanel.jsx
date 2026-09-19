/**
 * PreparationPanel.jsx — the college's record of what it did to prepare
 * students, written to the chain.
 *
 * The one screen on this platform where the college is the author rather than
 * the subject. Everything else holds it to account for results; this is its own
 * evidence of effort, and it is worth something precisely because it cannot be
 * edited afterwards. So there is no edit button here, only "this did not
 * happen" — which leaves the original entry visible beside the cancellation.
 *
 * The form says both of those things out loud before anyone submits, because a
 * permanent record that surprises its author is a bad record.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  GraduationCap,
  Plus,
  X,
  CheckCircle2,
  Ban,
  Users,
  CalendarDays,
} from "lucide-react";
import { api } from "../../utils/api.js";
import { getIdempotencyKey } from "../../utils/idempotency.js";
import { formatDate } from "../../utils/format.js";
import { LoadingRows } from "../shared/Loading.jsx";
import { useEscape } from "../../utils/useEscape.js";

export default function PreparationPanel({ onError, onNotice }) {
  const [events, setEvents] = useState([]);
  const [summary, setSummary] = useState(null);
  const [kinds, setKinds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState(null);

  const load = useCallback(() => {
    Promise.all([api.get("/college/events"), api.get("/college/events/kinds")])
      .then(([e, k]) => {
        setEvents(e.events);
        setSummary(e.summary);
        setKinds(k.kinds);
      })
      .catch((err) => onError(err.message))
      .finally(() => setLoading(false));
  }, [onError]);

  useEffect(load, [load]);

  if (loading) return <LoadingRows rows={3} label="Reading the preparation record" />;

  return (
    <div className="stack">
      <div>
        <div className="section-head">
          <div className="section-eyebrow flex items-center gap-6">
            <GraduationCap size={13} /> Preparation record
            {summary && (
              <span style={{ color: "var(--text-muted)" }}>
                · {summary.standing} held · {summary.attendances} attended
                {summary.cancelled > 0 && ` · ${summary.cancelled} cancelled`}
              </span>
            )}
          </div>
          {!adding && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
              <Plus size={14} /> Record a session
            </button>
          )}
        </div>
        <p className="form-hint" style={{ margin: 0 }}>
          Training, mock interviews, workshops and seminars you ran. Entries are permanent;
          one that didn't happen is marked, not removed.
        </p>
      </div>

      {adding && (
        <EventForm
          kinds={kinds}
          onCancel={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            load();
            onNotice("Recorded on-chain.");
          }}
          onError={onError}
        />
      )}

      <div className="row-list">
        {events.length === 0 && <div className="row-empty">Nothing recorded yet.</div>}
        {events.map((e) => (
          <div key={e.id} className="row" style={{ opacity: e.cancelled ? 0.72 : 1 }}>
            <div style={{ minWidth: 0 }}>
              <div className="flex items-center gap-8" style={{ flexWrap: "wrap" }}>
                <strong className="item-title">{e.title}</strong>
                <span className="pill pill-muted">{e.kind}</span>
                {e.cancelled && (
                  <span className="pill">
                    <Ban size={10} /> Did not happen
                  </span>
                )}
              </div>
              <div className="row-meta flex items-center gap-12" style={{ marginTop: 2, flexWrap: "wrap" }}>
                <span className="flex items-center gap-4">
                  <CalendarDays size={12} /> {formatDate(e.heldOn)}
                </span>
                <span className="flex items-center gap-4">
                  <Users size={12} /> {e.attendance} attended
                </span>
                <span>By {e.conductedBy}</span>
                {e.batchYear && <span>Batch {e.batchYear}</span>}
              </div>
              {e.cancelled && e.cancelReason && (
                <div className="row-meta" style={{ marginTop: 2 }}>Reason: {e.cancelReason}</div>
              )}
            </div>

            {!e.cancelled && cancelling !== e.id && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCancelling(e.id)}>
                <Ban size={14} /> Didn't happen
              </button>
            )}

            {cancelling === e.id && (
              <div style={{ flexBasis: "100%" }}>
                <CancelForm
                  eventId={e.id}
                  onCancel={() => setCancelling(null)}
                  onSaved={() => {
                    setCancelling(null);
                    load();
                    onNotice("Recorded as cancelled. The original entry stays visible.");
                  }}
                  onError={onError}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function EventForm({ kinds, onCancel, onSaved, onError }) {
  useEscape(onCancel);
  const today = new Date().toISOString().slice(0, 10);
  const [values, setValues] = useState({
    kind: kinds[0]?.key ?? "Training",
    title: "",
    conductedBy: "",
    date: today,
    attendance: "",
    batchYear: "",
  });
  const [busy, setBusy] = useState(false);
  const keyRef = useRef(null);

  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    onError("");
    try {
      const payload = {
        kind: values.kind,
        title: values.title,
        conductedBy: values.conductedBy,
        heldOn: Math.floor(new Date(`${values.date}T12:00:00`).getTime() / 1000),
        attendance: values.attendance === "" ? 0 : Number(values.attendance),
        batchYear: values.batchYear === "" ? 0 : Number(values.batchYear),
      };
      // A session is permanent and cannot be edited, so a retry after a lost
      // response must not write it twice.
      await api.post("/college/events", {
        ...payload,
        idempotencyKey: getIdempotencyKey(keyRef, JSON.stringify(payload)),
      });
      onSaved();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="glass-card p-24 flex flex-col gap-12">
      <div className="flex items-center justify-between">
        <h3 className="card-title">Record a session</h3>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} aria-label="Close">
          <X size={14} />
        </button>
      </div>

      <div className="form-grid">
        <div className="form-group span-all">
          <label htmlFor="pe-title">What it was</label>
          <input
            id="pe-title"
            value={values.title}
            onChange={set("title")}
            placeholder="e.g. Aptitude Test Series - Round 3"
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="pe-kind">Kind</label>
          <select id="pe-kind" value={values.kind} onChange={set("kind")}>
            {kinds.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="pe-date">Date held</label>
          <input id="pe-date" type="date" value={values.date} onChange={set("date")} required />
        </div>
        <div className="form-group">
          <label htmlFor="pe-by">Conducted by</label>
          <input
            id="pe-by"
            value={values.conductedBy}
            onChange={set("conductedBy")}
            placeholder="e.g. Placement Cell"
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="pe-attendance">Students who attended</label>
          <input
            id="pe-attendance"
            type="number" inputMode="decimal"
            min="0"
            value={values.attendance}
            onChange={set("attendance")}
            placeholder="0"
          />
        </div>
        <div className="form-group">
          <label htmlFor="pe-batch">
            Batch <span className="label-optional">(blank = all)</span>
          </label>
          <input
            id="pe-batch"
            type="number" inputMode="decimal"
            min="2000"
            max="2100"
            value={values.batchYear}
            onChange={set("batchYear")}
            placeholder="2026"
          />
        </div>
      </div>

      <p className="form-hint" style={{ margin: 0 }}>
        This goes on the blockchain and can't be edited later. If it turns out not to have
        happened, you can mark it so.
      </p>

      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? <span className="spinner" /> : <><CheckCircle2 size={14} /> Add to the record</>}
      </button>
    </form>
  );
}

function CancelForm({ eventId, onCancel, onSaved, onError }) {
  useEscape(onCancel);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    onError("");
    try {
      await api.post(`/college/events/${eventId}/cancel`, { reason });
      onSaved();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-12" style={{ marginTop: "var(--space-4)" }}>
      <div className="form-group">
        <label htmlFor={`pc-${eventId}`}>Why didn't it happen?</label>
        <input
          id={`pc-${eventId}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Trainer unavailable"
        />
        <p className="form-hint">
          The entry stays on the record with this note attached — it is never removed.
        </p>
      </div>
      <div className="flex gap-8">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {busy ? <span className="spinner" /> : "Confirm"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Never mind
        </button>
      </div>
    </form>
  );
}
