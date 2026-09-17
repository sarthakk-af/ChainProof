/**
 * PublicDashboard.jsx — the page a parent reads.
 *
 * No login. It answers a small number of specific questions, in the order a
 * parent asks them:
 *
 *   1. How many students in this batch actually got placed — out of how many?
 *   2. Which companies came, and what did they pay?
 *   3. What did the college do to prepare students?
 *   4. Is there anything I should be wary of in these figures?
 *
 * So the page leads with one batch's headline figures, each shown beside the
 * number it is a share of, and puts the detail behind tabs rather than in one
 * long scroll. The selected batch and tab live in the URL, so a parent can
 * send someone the exact view they were looking at.
 *
 * No individual ever appears here. Accountability is owed by the institution,
 * not by the student who didn't get picked.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronRight } from "lucide-react";
import { api } from "../utils/api.js";
import { formatDate, formatLPA } from "../utils/format.js";

const TABS = [
  { id: "companies", label: "Companies" },
  { id: "preparation", label: "Preparation" },
  { id: "notices", label: "Notices" },
  { id: "guide", label: "How to read this" },
];

function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  return {
    batch: params.get("batch") ? Number(params.get("batch")) : null,
    tab: TABS.some((t) => t.id === params.get("tab")) ? params.get("tab") : "companies",
  };
}

function writeUrlState({ batch, tab }) {
  const params = new URLSearchParams(window.location.search);
  if (batch) params.set("batch", String(batch));
  else params.delete("batch");
  params.set("tab", tab);
  window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export default function PublicDashboard() {
  const initial = useMemo(readUrlState, []);
  const [college, setCollege] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [batches, setBatches] = useState([]);
  const [drives, setDrives] = useState([]);
  const [notices, setNotices] = useState([]);
  const [preparation, setPreparation] = useState(null);

  const [batch, setBatch] = useState(initial.batch);
  const [tab, setTab] = useState(initial.tab);

  // This build hosts one college, so the page is about that college rather
  // than asking a parent to pick one from a list of one.
  useEffect(() => {
    api
      .get("/public/colleges")
      .then(async ({ colleges }) => {
        const c = colleges[0];
        if (!c) return;
        setCollege(c);
        const [p, d, n] = await Promise.all([
          api.get(`/public/colleges/${c.address}/placement`),
          api.get(`/public/colleges/${c.address}/drives`),
          api.get(`/public/colleges/${c.address}/announcements`),
        ]);
        setBatches(p.batches);
        setDrives(d.drives);
        setNotices(n.announcements);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // The batches worth offering: any the college declared, plus any a drive was
  // aimed at, newest first.
  const years = useMemo(() => {
    const all = new Set([...batches.map((b) => b.batchYear), ...drives.map((d) => d.batchYear)]);
    return [...all].sort((a, b) => b - a);
  }, [batches, drives]);

  useEffect(() => {
    if (years.length === 0) return;
    if (!batch || !years.includes(batch)) setBatch(years[0]);
  }, [years, batch]);

  useEffect(() => {
    writeUrlState({ batch, tab });
  }, [batch, tab]);

  const loadPreparation = useCallback(() => {
    if (!college || !batch) return;
    api
      .get(`/public/colleges/${college.address}/preparation?batchYear=${batch}`)
      .then(setPreparation)
      .catch((e) => setError(e.message));
  }, [college, batch]);

  useEffect(loadPreparation, [loadPreparation]);

  // Drives that ran come first, newest first; called-off ones sink to the end,
  // where they stay visible without leading the list.
  const batchDrives = useMemo(
    () =>
      drives
        .filter((d) => d.batchYear === batch)
        .sort(
          (a, b) =>
            Number(a.status === "Cancelled") - Number(b.status === "Cancelled") ||
            b.driveDate - a.driveDate
        ),
    [drives, batch]
  );
  const batchFigures = batches.find((b) => b.batchYear === batch) ?? null;

  if (loading) {
    return (
      <div className="page-container flex justify-center items-center" style={{ minHeight: 300 }}>
        <div className="spinner" />
      </div>
    );
  }

  // A failed request must not read as "nothing to show" — a parent would take
  // that as the college having no results, which is a claim, not an outage.
  if (!college && error) {
    return (
      <div className="page-container animate-fade-in-up">
        <div className="alert alert-danger" role="alert" style={{ marginTop: 40 }}>
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            The placement record couldn't be loaded right now ({error}). Please try again in
            a moment.
          </span>
        </div>
      </div>
    );
  }

  if (!college) {
    return (
      <div className="page-container animate-fade-in-up">
        <div className="pub-empty" style={{ marginTop: 40 }}>
          <strong>Nothing published yet</strong>
          The college hasn't been set up on this platform yet. Figures appear here as soon as
          it declares its first batch.
        </div>
      </div>
    );
  }

  const counts = {
    companies: batchDrives.length,
    preparation: preparation?.summary?.standing ?? 0,
    notices: notices.length,
  };

  return (
    <div className="page-container animate-fade-in-up">
      <header className="pub-head">
        <div className="section-eyebrow">Public record · no sign-in needed</div>
        <h1>{college.name}</h1>
        <p>
          Placement results as each party recorded them: companies record their offers,
          students record whether they accepted, and the college records its batch sizes
          and training. None of it can be edited afterwards.
        </p>
      </header>

      {error && (
        <div className="alert alert-danger" role="alert" style={{ marginBottom: 18 }}>
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{error}</span>
        </div>
      )}

      {years.length === 0 ? (
        <div className="pub-empty">
          <strong>No batches published yet</strong>
          Results will appear once the college declares a batch or a company runs a drive.
        </div>
      ) : (
        <>
          <div className="pub-controls">
            <span className="label">Batch</span>
            <div className="seg" role="tablist" aria-label="Graduating batch">
              {years.map((y) => (
                <button
                  key={y}
                  type="button"
                  role="tab"
                  aria-selected={y === batch}
                  onClick={() => setBatch(y)}
                >
                  {y}
                </button>
              ))}
            </div>
          </div>

          <Headline figures={batchFigures} drives={batchDrives} preparation={preparation} />

          {batchFigures?.declaredStrengthRevisions > 0 && (
            <div className="alert alert-warning" role="status" style={{ fontSize: "0.82rem" }}>
              <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                The college has changed the declared size of this batch{" "}
                {batchFigures.declaredStrengthRevisions === 1
                  ? "once"
                  : `${batchFigures.declaredStrengthRevisions} times`}
                . A smaller batch makes the same number of placements look like a higher
                percentage, so every change is kept on the public record.
              </span>
            </div>
          )}

          <div className="pub-tabs">
            <div className="seg" role="tablist" aria-label="Section">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={t.id === tab}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                  {counts[t.id] !== undefined && <span className="count">{counts[t.id]}</span>}
                </button>
              ))}
            </div>
          </div>

          <div role="tabpanel">
            {tab === "companies" && <Companies drives={batchDrives} batch={batch} />}
            {tab === "preparation" && <Preparation preparation={preparation} batch={batch} />}
            {tab === "notices" && <Notices notices={notices} />}
            {tab === "guide" && <Guide />}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * The four figures a parent came for, each beside what it is a share of.
 *
 * "Placed" is shown against the batch the college declared, not against the
 * students who happened to sign up — the second number is always smaller, and
 * quoting a rate against it is the usual way a placement figure flatters
 * itself. The sign-up figure is still shown, underneath, so both are visible.
 */
function Headline({ figures, drives: allDrives, preparation }) {
  // A drive that was called off never recruited anyone, so it must not raise
  // the company count or pull the median package towards an offer nobody got.
  const drives = allDrives.filter((d) => d.status !== "Cancelled");
  const calledOff = allDrives.length - drives.length;
  const packages = drives.map((d) => d.annualPackage).filter((p) => p > 0);
  const companies = new Set(drives.map((d) => d.companyAddress)).size;
  const offered = drives.reduce((sum, d) => sum + (d.funnel?.offered ?? 0), 0);
  const summary = preparation?.summary;

  return (
    <section className="pub-kpis" aria-label="Headline figures">
      <div className="pub-kpi">
        <div className="k-label">Placed</div>
        {figures ? (
          <>
            <span className="k-value">
              {figures.placed} <small>of {figures.declaredStrength}</small>
            </span>
            <div className="pub-meter" aria-hidden="true">
              <span style={{ width: `${Math.min(figures.placementRateOfBatch, 100)}%` }} />
            </div>
            <div className="k-note">
              <strong>{figures.placementRateOfBatch}%</strong> of the batch.{" "}
              {figures.registered} signed up here; {figures.placementRateOfRegistered}% of
              those were placed.
            </div>
          </>
        ) : (
          <>
            <span className="k-value">—</span>
            <div className="k-note">
              The college hasn't declared this batch's size, so no percentage can be
              given.
            </div>
          </>
        )}
      </div>

      <div className="pub-kpi">
        <div className="k-label">Companies</div>
        <span className="k-value">{companies}</span>
        <div className="k-note">
          {drives.length} drive{drives.length === 1 ? "" : "s"} · {offered} offer
          {offered === 1 ? "" : "s"} made
          {calledOff > 0 && ` · ${calledOff} called off`}
        </div>
      </div>

      <div className="pub-kpi">
        <div className="k-label">Highest package</div>
        <span className="k-value">{packages.length ? formatLPA(Math.max(...packages)) : "—"}</span>
        <div className="k-note">
          {packages.length ? (
            <>
              Median <strong>{formatLPA(median(packages))}</strong>, across drives — as each
              company advertised it.
            </>
          ) : (
            "No drives for this batch yet."
          )}
        </div>
      </div>

      <div className="pub-kpi">
        <div className="k-label">Preparation</div>
        <span className="k-value">{summary ? summary.standing : "—"}</span>
        <div className="k-note">
          {summary && summary.standing > 0 ? (
            <>
              sessions held · <strong>{summary.attendances.toLocaleString("en-IN")}</strong>{" "}
              attendances
            </>
          ) : (
            "No training or mock interviews recorded yet."
          )}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function Companies({ drives, batch }) {
  const [open, setOpen] = useState(null);

  if (drives.length === 0) {
    return (
      <div className="pub-empty">
        <strong>No drives for the {batch} batch yet</strong>
        Companies appear here once the college agrees to host their drive.
      </div>
    );
  }

  return (
    <>
      <div className="pub-ledger">
        <div className="pub-row-head" aria-hidden="true">
          <span>Company &amp; role</span>
          <span>Package</span>
          <span>Cutoff</span>
          <span>Applied → offered → accepted</span>
          <span />
        </div>
        {drives.map((d) => (
          <div className="pub-item" key={d.id}>
            <button
              type="button"
              className="pub-row"
              aria-expanded={open === d.id}
              onClick={() => setOpen(open === d.id ? null : d.id)}
            >
              <span>
                <span className="company">
                  {d.companyName}
                  {d.status === "Cancelled" && <span className="pub-tag warn">Called off</span>}
                </span>
                <span className="role" style={{ display: "block" }}>
                  {d.roleTitle} · {formatDate(d.driveDate)}
                </span>
              </span>
              <span className="money cell-pay">{formatLPA(d.annualPackage)}</span>
              <span className="muted cell-cutoff">
                {d.minCgpa ? `CGPA ${d.minCgpa.toFixed(2)}` : "No cutoff"}
              </span>
              <span className="cell-flow">
                {d.status === "Cancelled" ? (
                  <span className="pub-flow">
                    <span className="pending">called off before any results</span>
                  </span>
                ) : (
                  <Flow funnel={d.funnel} />
                )}
              </span>
              <ChevronRight size={16} className="chev" aria-hidden="true" />
            </button>
            {open === d.id && <DriveDetail drive={d} />}
          </div>
        ))}
      </div>
      <p className="pub-note">
        Every figure in a row is the company's own, recorded on the blockchain. A student
        counts as placed only once they accept — an offer that was declined or withdrawn
        doesn't count.
      </p>
    </>
  );
}

/** Applied → offered → accepted, in one line. */
function Flow({ funnel }) {
  const applied = funnel?.applied;
  return (
    <span className="pub-flow">
      {applied === null || applied === undefined ? (
        <span className="pending">applicants not yet published</span>
      ) : (
        <span className="step">
          {applied}
          <small>applied</small>
        </span>
      )}
      <span className="arrow" aria-hidden="true">→</span>
      <span className="step">
        {funnel?.offered ?? 0}
        <small>offered</small>
      </span>
      <span className="arrow" aria-hidden="true">→</span>
      <span className="step final">
        {funnel?.accepted ?? 0}
        <small>accepted</small>
      </span>
    </span>
  );
}

function DriveDetail({ drive }) {
  const f = drive.funnel ?? {};
  // Middle stages are optional — plenty of companies run no written assessment
  // — so a zero there means "this company didn't have that round", not "nobody
  // passed it". Showing an empty bar would say the second.
  const steps = [
    ["Applied", f.applied, false],
    ["Shortlisted", f.shortlisted, true],
    ["Assessment", f.assessed, true],
    ["Interviewed", f.interviewed, true],
    ["Offered", f.offered, false],
    ["Accepted", f.accepted, false],
  ]
    .filter(([, value, optional]) => !(optional && !value))
    .map(([label, value]) => [label, value]);
  // Bars are scaled against applicants when the company has published that
  // figure, otherwise against the widest stage — so a missing total never
  // renders every bar as full.
  const base = f.applied || Math.max(1, ...steps.map(([, v]) => v ?? 0));
  const selectionRate =
    f.applied && f.accepted !== undefined
      ? Math.round((f.accepted / f.applied) * 1000) / 10
      : null;

  return (
    <div className="pub-detail">
      <div className="pub-detail-grid">
        <div>
          {steps.map(([label, value]) => (
            <div className="pub-bar" key={label}>
              <div className="row">
                <span>{label}</span>
                <span>{value === null || value === undefined ? "not published" : value}</span>
              </div>
              <div className="track">
                <span style={{ width: `${value ? Math.min((value / base) * 100, 100) : 0}%` }} />
              </div>
            </div>
          ))}
        </div>
        <dl className="pub-facts">
          <dt>Role</dt>
          <dd>{drive.roleTitle}</dd>
          <dt>Package</dt>
          <dd>₹{drive.annualPackage.toLocaleString("en-IN")} a year</dd>
          <dt>Eligibility</dt>
          <dd>
            Batch {drive.batchYear}
            {drive.minCgpa ? `, CGPA ${drive.minCgpa.toFixed(2)} or above` : ", no CGPA cutoff"}
          </dd>
          <dt>Drive date</dt>
          <dd>{formatDate(drive.driveDate)}</dd>
          <dt>Applications closed</dt>
          <dd>{formatDate(drive.applicationDeadline)}</dd>
          {selectionRate !== null && (
            <>
              <dt>Selection rate</dt>
              <dd>
                {f.accepted} of {f.applied} applicants ({selectionRate}%)
              </dd>
            </>
          )}
          {drive.status === "Cancelled" && (
            <>
              <dt>Status</dt>
              <dd>Called off after it was announced</dd>
            </>
          )}
        </dl>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * What the college did to prepare students.
 *
 * The other half of the story. Everything else on this page holds the college
 * to account for results, and a weak year can always be blamed on the market.
 * These sessions were recorded as the year went and cannot be added
 * afterwards, which is the only reason they are worth reading. Sessions the
 * college later said did not happen stay visible, struck through.
 */
function Preparation({ preparation, batch }) {
  if (!preparation) return <p className="pub-note">Loading…</p>;
  const { summary, events } = preparation;

  if (events.length === 0) {
    return (
      <div className="pub-empty">
        <strong>No preparation recorded for {batch}</strong>
        Training sessions, mock interviews and workshops appear here as the college
        records them.
      </div>
    );
  }

  return (
    <>
      <div className="pub-kinds">
        {summary.byKind
          .filter((k) => k.standing > 0)
          .map((k) => (
            <span key={k.kind} className="pill">
              {k.kind} · {k.standing}
            </span>
          ))}
        {summary.cancelled > 0 && (
          <span className="pill pill-muted">Called off · {summary.cancelled}</span>
        )}
      </div>

      <div className="pub-events">
        {events.map((e) => (
          <div key={e.id} className={`pub-event${e.cancelled ? " cancelled" : ""}`}>
            <span className="date">{formatDate(e.heldOn)}</span>
            <div>
              <div className="title">
                {e.title}
                {e.cancelled && <span className="pub-tag muted">Did not happen</span>}
              </div>
              <div className="by">
                {e.kind} · {e.conductedBy}
                {!e.batchYear && " · open to all batches"}
                {e.cancelled && e.cancelReason ? ` · ${e.cancelReason}` : ""}
              </div>
            </div>
            <span className="n">{e.cancelled ? "—" : `${e.attendance} attended`}</span>
          </div>
        ))}
      </div>

      <p className="pub-note">
        Attendance is counted per session, so one student at three sessions counts three
        times. Sessions open to every batch are included here too.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------

function Notices({ notices }) {
  if (notices.length === 0) {
    return (
      <div className="pub-empty">
        <strong>No public notices</strong>
        The placement cell hasn't posted anything for the public yet.
      </div>
    );
  }

  return (
    <>
      {notices.map((n) => (
        <article key={n.id} className="pub-notice">
          <h4>{n.title}</h4>
          <p>{n.body}</p>
          <div className="meta">
            {n.authorName} · {formatDate(Math.floor(n.createdAt / 1000))}
            {n.editedAt && " · edited"}
          </div>
        </article>
      ))}
      <p className="pub-note">
        Notices are announcements and can be edited or withdrawn — an edited one is marked.
        Everything under Companies and Preparation is on the blockchain and cannot be.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------

function Guide() {
  const items = [
    [
      "Placed means accepted",
      "A student counts as placed only once they accept an offer themselves. An offer that was declined, or that the company later withdrew, does not count.",
    ],
    [
      "Out of the whole batch",
      "The main percentage is placements divided by the batch size the college declared. The share of students who signed up here is shown too, but it is always the smaller, kinder denominator.",
    ],
    [
      "Who wrote each figure",
      "Companies record their own terms, applicants and results. Students record their own answers. The college records batch sizes and its training. Nobody can write a figure on another party's behalf — not even the site's administrator.",
    ],
    [
      "Nothing is quietly changed",
      "Figures are stored on a blockchain, so they cannot be edited later. A correction is a new entry beside the old one: a withdrawn offer, a revised batch size and a cancelled session all stay visible.",
    ],
    [
      "No one is named",
      "This page never shows an individual student. Accountability belongs to the institution, not to the student who wasn't picked.",
    ],
    [
      "Packages are as advertised",
      "Each package is the figure the company published when it posted the drive, in rupees a year. It is not a guarantee of any individual's final salary.",
    ],
  ];

  return (
    <div className="pub-explain">
      {items.map(([title, body]) => (
        <div key={title}>
          <h4>{title}</h4>
          <p>{body}</p>
        </div>
      ))}
    </div>
  );
}
