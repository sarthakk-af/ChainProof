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

import React, { useCallback, useEffect, useState } from "react";
import {
  GraduationCap,
  Plus,
  X,
  AlertCircle,
  CheckCircle2,
  Ban,
  Users,
  CalendarDays,
} from "lucide-react";
import { api } from "../../utils/api.js";
import { formatDate } from "../../utils/format.js";

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

  if (loading) return <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Loading…</p>;

  return (
    <div className="flex flex-col gap-20">
      <div className="glass-card p-24">
        <div className="flex items-center gap-8" style={{ marginBottom: 6 }}>
          <GraduationCap size={16} />
          <strong style={{ fontFamily: "var(--font-head)" }}>Preparation record</strong>
        </div>
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
          Training, mock interviews, workshops and seminars you ran. This is the one record
          here that is yours to write — and it is permanent, so it shows what you did as
          the year went rather than what was remembered at the end of it.
        </p>

        {summary && (
          <div className="flex gap-24" style={{ flexWrap: "wrap", marginTop: 16 }}>
            <Stat label="Sessions held" value={summary.standing} />
            <Stat label="Total attendance" value={summary.attendances} />
            {summary.cancelled > 0 && <Stat label="Cancelled" value={summary.cancelled} muted />}
          </div>
        )}
      </div>

      {!adding && (
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding(true)} style={{ alignSelf: "flex-start" }}>
          <Plus size={14} /> Record a session
        </button>
      )}

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

      {events.length === 0 && (
        <div className="glass-card p-24" style={{ textAlign: "center" }}>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
            Nothing recorded yet.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-12">
        {events.map((e) => (
          <div key={e.id} className="glass-card p-24" style={{ opacity: e.cancelled ? 0.72 : 1 }}>
            <div className="flex items-start justify-between gap-12" style={{ flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div className="flex items-center gap-8" style={{ flexWrap: "wrap" }}>
                  <strong style={{ fontFamily: "var(--font-head)" }}>{e.title}</strong>
                  <span className="pill pill-muted" style={{ fontSize: "0.68rem" }}>{e.kind}</span>
                  {e.cancelled && (
                    <span className="pill" style={{ fontSize: "0.68rem" }}>
                      <Ban size={10} /> Did not happen
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: "0.78rem",
                    color: "var(--text-muted)",
                    marginTop: 6,
                    display: "flex",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <CalendarDays size={12} /> {formatDate(e.heldOn)}
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Users size={12} /> {e.attendance} attended
                  </span>
                  <span>By {e.conductedBy}</span>
                  {e.batchYear && <span>Batch {e.batchYear}</span>}
                </div>
                {e.cancelled && e.cancelReason && (
                  <p style={{ fontSize: "0.8rem", marginTop: 8 }}>Reason: {e.cancelReason}</p>
                )}
              </div>

              {!e.cancelled && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setCancelling(e.id)}
                  style={{ flexShrink: 0 }}
                >
                  <Ban size={13} /> Didn't happen
                </button>
              )}
            </div>

            {cancelling === e.id && (
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
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, muted }) {
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--font-head)",
          fontSize: "1.6rem",
          color: muted ? "var(--text-muted)" : "inherit",
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{label}</div>
    </div>
  );
}

function EventForm({ kinds, onCancel, onSaved, onError }) {
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

  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    onError("");
    try {
      await api.post("/college/events", {
        kind: values.kind,
        title: values.title,
        conductedBy: values.conductedBy,
        heldOn: Math.floor(new Date(`${values.date}T12:00:00`).getTime() / 1000),
        attendance: values.attendance === "" ? 0 : Number(values.attendance),
        batchYear: values.batchYear === "" ? 0 : Number(values.batchYear),
      });
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
        <strong style={{ fontFamily: "var(--font-head)" }}>Record a session</strong>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          <X size={14} />
        </button>
      </div>

      <div className="flex gap-12" style={{ flexWrap: "wrap" }}>
        <div className="form-group" style={{ flex: "1 1 160px" }}>
          <label htmlFor="pe-kind">Kind</label>
          <select id="pe-kind" value={values.kind} onChange={set("kind")}>
            {kinds.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group" style={{ flex: "1 1 150px" }}>
          <label htmlFor="pe-date">Date held</label>
          <input id="pe-date" type="date" value={values.date} onChange={set("date")} required />
        </div>
      </div>

      <div className="form-group">
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
        <label htmlFor="pe-by">Conducted by</label>
        <input
          id="pe-by"
          value={values.conductedBy}
          onChange={set("conductedBy")}
          placeholder="e.g. Placement Cell, or an outside trainer"
          required
        />
      </div>

      <div className="flex gap-12" style={{ flexWrap: "wrap" }}>
        <div className="form-group" style={{ flex: "1 1 140px" }}>
          <label htmlFor="pe-attendance">Students who attended</label>
          <input
            id="pe-attendance"
            type="number"
            min="0"
            value={values.attendance}
            onChange={set("attendance")}
            placeholder="0"
          />
        </div>
        <div className="form-group" style={{ flex: "1 1 140px" }}>
          <label htmlFor="pe-batch">
            Batch <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(blank = all)</span>
          </label>
          <input
            id="pe-batch"
            type="number"
            min="2000"
            max="2100"
            value={values.batchYear}
            onChange={set("batchYear")}
            placeholder="2026"
          />
        </div>
      </div>

      <div className="alert alert-info" role="status">
        <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
        <span style={{ fontSize: "0.82rem" }}>
          This goes on the blockchain and cannot be edited afterwards. If a session you
          recorded turns out not to have happened, you can mark it so — the original entry
          stays visible beside it.
        </span>
      </div>

      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? <span className="spinner" /> : <><CheckCircle2 size={14} /> Record on-chain</>}
      </button>
    </form>
  );
}

function CancelForm({ eventId, onCancel, onSaved, onError }) {
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
    <form onSubmit={submit} className="flex flex-col gap-12" style={{ marginTop: 16 }}>
      <div className="form-group">
        <label htmlFor={`pc-${eventId}`}>Why didn't it happen?</label>
        <input
          id={`pc-${eventId}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Trainer unavailable"
        />
        <p style={{ fontSize: "0.74rem", color: "var(--text-muted)", marginTop: 4 }}>
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
