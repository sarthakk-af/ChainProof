/**
 * HowItWorks.jsx — how the blockchain is actually used here, at /how-it-works.
 *
 * /about (ProjectExplainer.jsx) answers "what is this and why": the problem,
 * the roles, the questions people ask. This page answers "how": which records
 * go on the chain and which never do, the four contracts and who may write to
 * each, one placement followed through every transaction, and live proof read
 * from the chain — so a reader can check the claims rather than take them.
 *
 * Written for someone who has never used a blockchain. Every term is explained
 * where it is first used, and again in the glossary at the end.
 */

import React, { useEffect, useState } from "react";
import {
  Monitor, Server, Blocks, Database, ExternalLink, ChevronLeft, ChevronRight,
  Fingerprint, Wallet, Fuel, TriangleAlert, Activity, ArrowRight,
} from "lucide-react";
import { api } from "../utils/api.js";
import { Link } from "../utils/navigation.jsx";

// ── Content ──────────────────────────────────────────────────────────────────

const ON_CHAIN = [
  "Who is who — the college, each company, each verified student — as wallet addresses",
  "Each company's admission by the college, and any suspension",
  "The batch sizes the college declares, with every revision",
  "Each drive's terms: role, package, CGPA cutoff, dates",
  "A fingerprint of each job description",
  "Every stage a company records for a candidate, including offers",
  "Every student's answer to an offer, and who counts as placed",
  "The training sessions the college ran",
];

const OFF_CHAIN = [
  "Names, emails and phone numbers",
  "Roll numbers and the college's roster",
  "Resumes, skills and CGPA",
  "Passwords (stored scrambled, never readable)",
  "The full text of each job description",
  "Applications, notices and preferences",
  "A fast copy of the on-chain records, for quick page loads",
];

const CONTRACTS = {
  ActorRegistry: {
    role: "The register of who is who",
    records: "Every account's role and standing, and the college's declared batch sizes.",
    rules: [
      "Anyone can register themselves — but only as themselves",
      "Only the platform admits the college; only the college admits companies",
      "Only the college declares its batch sizes, and every change is kept",
    ],
  },
  PlacementDrive: {
    role: "The drives companies post",
    records: "Each drive's terms and its status: proposed, approved, closed or cancelled.",
    rules: [
      "Only a company writes its own drive's terms — the college can't edit them",
      "Only the college approves or declines hosting a drive",
      "Nothing is deleted: a called-off drive stays visible as cancelled",
    ],
  },
  DriveOutcomes: {
    role: "Results and offers",
    records: "Every stage of every candidate, each offer answer, and who counts as placed.",
    rules: [
      "Only the company that owns the drive records stages and offers",
      "Only the student can accept or decline their own offer",
      "Nobody counts as placed until they accept — and a withdrawn offer takes them back out",
    ],
  },
  PreparationLog: {
    role: "The college's training record",
    records: "Training, mock interviews and workshops the college says it ran.",
    rules: [
      "Only the college records its own sessions",
      "A session can be marked as not having happened, but never deleted",
      "The time it was recorded comes from the blockchain, not from the college",
    ],
  },
};

/** One placement, followed through every transaction it takes. */
const LIFECYCLE = [
  {
    who: "Company",
    title: "A company registers",
    call: "ActorRegistry.register",
    body: "The company signs up and fills in its details. Its wallet writes its own registration to the blockchain, marked as waiting for the college.",
    check: "The contract only lets a wallet register itself — nobody can register on someone else's behalf.",
  },
  {
    who: "College",
    title: "The college admits it",
    call: "ActorRegistry.approveActor",
    body: "The placement cell confirms this company really recruits on campus. From now on the company can post drives.",
    check: "Only the college can admit a company, and the admission is recorded with the college's own signature.",
  },
  {
    who: "College",
    title: "The college declares the batch size",
    call: "ActorRegistry.recordBatchStrength",
    body: "\"120 students in Computer Engineering, 2026.\" This is the number every placement percentage is divided by.",
    check: "It can be revised, but every revision is kept with the old value — a batch can't be quietly shrunk to raise the percentage.",
  },
  {
    who: "Company",
    title: "The company posts a drive",
    call: "PlacementDrive.postDrive",
    body: "Role, package, CGPA cutoff and dates go on the blockchain. The job description's text is stored by the server, and its fingerprint goes on the blockchain with the drive.",
    check: "Only the company writes these terms. If the description were changed later, its fingerprint would no longer match.",
  },
  {
    who: "College",
    title: "The college approves hosting it",
    call: "PlacementDrive.approveDrive",
    body: "The drive becomes visible to students, who apply through the website.",
    check: "The college decides whether to host it — but it can't change a single term the company wrote.",
  },
  {
    who: "Company",
    title: "The company records an offer",
    call: "DriveOutcomes.recordStage",
    body: "After its rounds, the company records each candidate's stage — shortlisted, interview, and finally offered.",
    check: "Only the company that owns the drive can record results for it. The college cannot write a single one.",
  },
  {
    who: "Student",
    title: "The student accepts",
    call: "DriveOutcomes.answerOffer",
    body: "The student accepts the offer, with their own wallet. Only now does the contract count them as placed.",
    check: "Only the student can answer their own offer. An offer nobody accepted never counts as a placement.",
  },
  {
    who: "Anyone",
    title: "Anyone can check it",
    call: "Read from the blockchain — no transaction",
    body: "The server reads the new records from the blockchain and the public results page updates. Anyone can open each transaction on Polygonscan and see it for themselves.",
    check: "Reading is free and needs no account — on this site or directly on the blockchain.",
  },
];

const GLOSSARY = [
  ["Blockchain", "A shared record kept by thousands of computers at once. Anyone can read it; nobody can change what is already written."],
  ["Block", "One page of that record. A new block is added every couple of seconds, holding the latest transactions."],
  ["Transaction", "One write to the blockchain — \"record this offer\" — signed by the wallet making it, with its own ID."],
  ["Smart contract", "A small program stored on the blockchain. It decides who may write what, and its rules can never be changed once deployed."],
  ["Wallet", "A blockchain account: a public address, and a secret key that signs its transactions. Here, every account has one without needing to know it."],
  ["Gas", "The small fee paid for each transaction, in the network's own currency."],
  ["POL", "Polygon's currency. On the Amoy test network it is free, from faucets, and worth nothing."],
  ["Testnet", "A practice version of a blockchain that works exactly like the real one, except its money is pretend."],
  ["Finality", "The moment a block can no longer be undone. ChainProof waits for it before treating anything as recorded."],
  ["Fingerprint (hash)", "A short code calculated from some text. Change one letter of the text and the code changes completely."],
  ["Polygonscan", "A public website for reading the Polygon blockchain — any address, any transaction — independently of ChainProof."],
];

// ── Helpers ──────────────────────────────────────────────────────────────────

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

function base32(bytes) {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(buffer << (5 - bits)) & 31];
  return out;
}

/**
 * The same fingerprint the server puts on-chain for a job description: an IPFS
 * content ID (CIDv1, raw, SHA-256). See backend/src/driveDocument.js's cidFor.
 * Computed here in the browser — nothing typed is sent anywhere.
 */
async function fingerprintOf(text) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  const cid = new Uint8Array(4 + digest.length);
  cid.set([0x01, 0x55, 0x12, 0x20]);
  cid.set(digest, 4);
  return "b" + base32(cid);
}

function shortHash(hash) {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

function timeAgo(seconds) {
  if (!seconds) return "";
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - seconds);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  const days = Math.floor(diff / 86400);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// ── Sections ─────────────────────────────────────────────────────────────────

function Section({ id, eyebrow, title, lead, children }) {
  return (
    <section id={id} className="landing-section hiw-section">
      <div className="landing-head">
        {eyebrow && <span className="section-eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
        {lead && <p>{lead}</p>}
      </div>
      {children}
    </section>
  );
}

function Architecture() {
  const tiers = [
    {
      Icon: Monitor,
      name: "Your browser",
      body: "The website. Sign in with an email and password — no crypto wallet, no extension.",
    },
    {
      Icon: Server,
      name: "ChainProof's server",
      body: "Keeps each account's wallet locked, signs its transactions, pays the fees, and keeps the private data.",
    },
    {
      Icon: Blocks,
      name: "Polygon blockchain",
      body: "Holds the four contracts and every record they accept — public and permanent.",
    },
  ];
  return (
    <>
      <div className="hiw-flow" role="list">
        {tiers.map((t, i) => (
          <React.Fragment key={t.name}>
            <div className="glass-card p-24 hiw-tier" role="listitem">
              <t.Icon size={22} style={{ color: "var(--accent-primary)" }} aria-hidden="true" />
              <h3 className="card-title">{t.name}</h3>
              <p className="card-lead">{t.body}</p>
            </div>
            {i < tiers.length - 1 && <ArrowRight className="hiw-arrow" size={22} aria-hidden="true" />}
          </React.Fragment>
        ))}
      </div>

      <div className="compare" style={{ marginTop: "var(--space-5)" }}>
        <div className="compare-col good">
          <h3>On the blockchain — public, permanent</h3>
          {ON_CHAIN.map((item) => (
            <div key={item} className="compare-item good"><span className="mk">⛓</span> {item}</div>
          ))}
        </div>
        <div className="compare-col">
          <h3 style={{ color: "var(--text-primary)" }}>
            <Database size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} aria-hidden="true" />
            In the college's database — private, erasable
          </h3>
          {OFF_CHAIN.map((item) => (
            <div key={item} className="compare-item"><span className="mk">▪</span> {item}</div>
          ))}
        </div>
      </div>
      <p className="form-hint" style={{ marginTop: "var(--space-3)" }}>
        Why the split: a blockchain can never forget, and anyone can read it. That is exactly
        right for an offer, and exactly wrong for someone's phone number. So the chain holds
        events tied to anonymous wallet addresses, and everything personal stays where it can be
        corrected and deleted.
      </p>
    </>
  );
}

function ContractCards({ chain }) {
  const byName = Object.fromEntries((chain?.contracts ?? []).map((c) => [c.name, c]));
  return (
    <div className="hiw-grid-2">
      {Object.entries(CONTRACTS).map(([name, c]) => {
        const live = byName[name];
        return (
          <div key={name} className="glass-card p-24 flex flex-col gap-12">
            <div>
              <span className="section-eyebrow" style={{ margin: 0 }}>{c.role}</span>
              <h3 className="card-title mono-title">{name}</h3>
              <p className="card-lead">{c.records}</p>
            </div>
            <ul className="hiw-rules">
              {c.rules.map((r) => <li key={r}>{r}</li>)}
            </ul>
            {live && (
              <div className="hiw-address">
                <span className="mono-addr" title={live.address}>{live.address}</span>
                {live.url && (
                  <a href={live.url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
                    View on Polygonscan <ExternalLink size={14} aria-hidden="true" />
                  </a>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Lifecycle() {
  const [step, setStep] = useState(0);
  const s = LIFECYCLE[step];
  const last = LIFECYCLE.length - 1;
  return (
    <div className="glass-card p-24 hiw-stepper">
      <ol className="hiw-steps" aria-label="Steps">
        {LIFECYCLE.map((item, i) => (
          <li key={item.title}>
            <button
              type="button"
              className={`hiw-dot${i === step ? " is-current" : ""}${i < step ? " is-done" : ""}`}
              onClick={() => setStep(i)}
              aria-label={`Step ${i + 1}: ${item.title}`}
              aria-current={i === step ? "step" : undefined}
            >
              {i + 1}
            </button>
          </li>
        ))}
      </ol>

      <div className="hiw-step-body" aria-live="polite">
        <div className="flex items-center gap-8" style={{ flexWrap: "wrap", marginBottom: "var(--space-2)" }}>
          <span className={`badge badge-${s.who.toLowerCase() === "anyone" ? "none" : s.who.toLowerCase()}`}>
            Signed by: {s.who}
          </span>
          <code className="hiw-call">{s.call}</code>
        </div>
        <h3 style={{ marginBottom: "var(--space-2)" }}>
          {step + 1}. {s.title}
        </h3>
        <p style={{ marginBottom: "var(--space-3)" }}>{s.body}</p>
        <div className="alert alert-info" role="note">
          <span><strong>What the contract enforces:</strong> {s.check}</span>
        </div>
      </div>

      <div className="flex gap-8 items-center" style={{ justifyContent: "space-between", marginTop: "var(--space-4)" }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep(step - 1)} disabled={step === 0}>
          <ChevronLeft size={16} aria-hidden="true" /> Back
        </button>
        <span className="form-hint">Step {step + 1} of {LIFECYCLE.length}</span>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setStep(step + 1)} disabled={step === last}>
          Next <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function LiveProof({ chain, error, onRefresh }) {
  if (error) {
    return (
      <div className="alert alert-warning" role="status">
        <TriangleAlert size={16} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
        <span>The live record couldn't be loaded just now. {error}</span>
      </div>
    );
  }
  if (!chain) return <div className="glass-card p-24"><span className="spinner" /></div>;

  const { network, syncedBlock, activity } = chain;
  return (
    <div className="glass-card p-24">
      <div className="hiw-live-head">
        <div className="kpi">
          <span className="kpi-n">{network.name}</span>
          <span className="kpi-l">{network.testnet ? "Test network — no real money" : "Network"}</span>
        </div>
        <div className="kpi">
          <span className="kpi-n">{Number(syncedBlock).toLocaleString()}</span>
          <span className="kpi-l">Latest block read by this site</span>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRefresh}>
          <Activity size={14} aria-hidden="true" /> Refresh
        </button>
      </div>

      <h3 className="card-title" style={{ marginTop: "var(--space-4)" }}>Latest records on the blockchain</h3>
      {activity.length === 0 ? (
        <p className="card-lead" style={{ marginTop: "var(--space-2)" }}>
          Nothing recorded yet. As soon as the college is set up and the first company
          registers, each record appears here with a link to its transaction.
        </p>
      ) : (
        <ul className="hiw-feed">
          {activity.map((a) => (
            <li key={`${a.txHash}-${a.event}-${a.blockNumber}-${a.text}`}>
              <div>
                <div className="hiw-feed-text">{a.text}</div>
                <div className="row-meta">
                  {a.contract} · block {a.blockNumber.toLocaleString()}
                  {a.time ? ` · ${timeAgo(a.time)}` : ""}
                </div>
              </div>
              {a.txUrl ? (
                <a href={a.txUrl} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" title={a.txHash}>
                  View transaction <ExternalLink size={14} aria-hidden="true" />
                </a>
              ) : (
                <span className="mono-addr" title={a.txHash}>{shortHash(a.txHash)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="form-hint" style={{ marginTop: "var(--space-3)" }}>
        Students appear only as "a student" — the public pages never name or identify one.
        {!network.explorer && " This is a local test chain, so there is no public explorer to link to."}
      </p>
    </div>
  );
}

function FingerprintDemo() {
  const [text, setText] = useState("Software Engineer — ₹12 LPA, CGPA 7.0 and above");
  const [hash, setHash] = useState("");
  const supported = typeof crypto !== "undefined" && !!crypto.subtle;

  useEffect(() => {
    if (!supported) return undefined;
    let cancelled = false;
    fingerprintOf(text).then((h) => { if (!cancelled) setHash(h); });
    return () => { cancelled = true; };
  }, [text, supported]);

  return (
    <div className="glass-card p-24 flex flex-col gap-12">
      <div className="form-group">
        <label htmlFor="hiw-fp">Type anything — try changing a single letter</label>
        <textarea id="hiw-fp" rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
      </div>
      <div>
        <span className="section-eyebrow" style={{ margin: 0 }}>Its fingerprint</span>
        {supported ? (
          <code className="hiw-hash">{hash}</code>
        ) : (
          <p className="card-lead">This browser can't calculate it here (it needs a secure https connection).</p>
        )}
      </div>
      <p className="form-hint">
        This is calculated in your browser — nothing you type is sent anywhere. It's the same
        method the server uses for a job description: the fingerprint goes on the blockchain with
        the drive, so if anyone ever edited the description afterwards, its fingerprint would no
        longer match the one on record.
      </p>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function HowItWorks() {
  const [chain, setChain] = useState(null);
  const [error, setError] = useState("");

  const load = () => {
    setError("");
    api.get("/public/blockchain")
      .then(setChain)
      .catch((err) => setError(err.message || ""));
  };
  useEffect(load, []);

  return (
    <div className="page-container animate-fade-in-up" style={{ maxWidth: 1000 }}>
      <section className="landing-section">
        <div className="eyebrow-pill" style={{ marginBottom: "var(--space-4)" }}>
          <span className="dot" /> Under the hood
        </div>
        <h1 className="hero-title">How the blockchain works in ChainProof</h1>
        <p className="hero-lead">
          What goes on the blockchain and what never does, the four contracts that decide who may
          write what, and one placement followed through every transaction — with the live
          record at the end, so you can check it yourself.
        </p>
        <p className="form-hint">
          Looking for what ChainProof is and who it's for? <Link to="/about">Read the overview →</Link>
        </p>
      </section>

      <Section
        id="idea"
        eyebrow="1 · The idea"
        title="A record nobody can quietly change"
        lead="A blockchain is a record kept by thousands of computers at once. Anyone can read it, anyone can add to it, and nobody — not even whoever wrote it — can change what is already there."
      >
        <div className="steps-grid hiw-three">
          <div className="step-col">
            <span className="num">THE PROBLEM</span>
            <h4>Placement figures are self-reported</h4>
            <p>A college compiles its own numbers after the season, and nobody outside can check how.</p>
          </div>
          <div className="step-col">
            <span className="num">THE FIX</span>
            <h4>Each party signs its own part</h4>
            <p>The company records its offer, the student records their acceptance, the college records its batch size — each as it happens.</p>
          </div>
          <div className="step-col">
            <span className="num">THE RESULT</span>
            <h4>Figures anyone can verify</h4>
            <p>Nobody can inflate or erase a record afterwards, and anyone can check every one of them on the public blockchain.</p>
          </div>
        </div>
      </Section>

      <Section
        id="architecture"
        eyebrow="2 · The architecture"
        title="Three layers, and what each one holds"
        lead="It looks and works like any website. The blockchain sits underneath, and the server talks to it on everyone's behalf."
      >
        <Architecture />
      </Section>

      <Section
        id="contracts"
        eyebrow="3 · The smart contracts"
        title="Four contracts, each with its own rules"
        lead="A smart contract is a small program stored on the blockchain. It checks every write against its rules and refuses anything that breaks them. Once deployed, its code can never be changed — not even by the people who wrote it."
      >
        <ContractCards chain={chain} />
      </Section>

      <Section
        id="lifecycle"
        eyebrow="4 · One placement, step by step"
        title="From a company registering to a student counted as placed"
        lead="Every step is a separate transaction, signed by the one party allowed to make it."
      >
        <Lifecycle />
      </Section>

      <Section
        id="live"
        eyebrow="5 · Live proof"
        title="The record, read from the blockchain right now"
        lead="These are real transactions on the public blockchain. Open any of them on Polygonscan — a site ChainProof has no control over — and you'll see the same record."
      >
        <LiveProof chain={chain} error={error} onRefresh={load} />
      </Section>

      <Section
        id="fingerprint"
        eyebrow="6 · Try it"
        title="How a fingerprint proves nothing was changed"
        lead="Long text doesn't go on the blockchain — it would be slow and costly. Its fingerprint does, and that is enough to prove the text hasn't been touched."
      >
        <FingerprintDemo />
      </Section>

      <Section
        id="wallets"
        eyebrow="7 · Wallets and gas"
        title="Why nobody here needs a crypto wallet"
      >
        <div className="hiw-grid-2">
          <div className="glass-card p-24">
            <Wallet size={20} style={{ color: "var(--accent-primary)" }} aria-hidden="true" />
            <h3 className="card-title">A wallet for every account, kept by the server</h3>
            <p className="card-lead">
              Every account gets its own blockchain wallet when it signs up. Its secret key is
              stored encrypted on the server, which signs that account's transactions when its
              owner acts. So a student accepting an offer is really the student's own wallet
              signing — without them ever installing anything.
            </p>
          </div>
          <div className="glass-card p-24">
            <Fuel size={20} style={{ color: "var(--accent-primary)" }} aria-hidden="true" />
            <h3 className="card-title">The fees are paid for you</h3>
            <p className="card-lead">
              Every write costs a small fee, called gas. The platform's own wallet sends each
              account a little test POL before its first action — after its email is confirmed —
              and tops it up when it runs low. One action costs well under a hundredth of a POL,
              and on the test network POL is free.
            </p>
          </div>
        </div>
      </Section>

      <Section
        id="limits"
        eyebrow="8 · Honest limits"
        title="What this design does not guarantee"
      >
        <div className="faq">
          <div className="faq-item">
            <h3 className="card-title">The server holds the keys</h3>
            <p>
              So that nobody needs a crypto wallet, the server keeps every account's key. The
              blockchain proves which <em>wallet</em> signed a record, not which person — whoever
              runs the server could, in principle, sign as anyone. Letting users hold their own
              keys would remove this, at the cost of everyone needing a wallet.
            </p>
          </div>
          <div className="faq-item">
            <h3 className="card-title">It runs on a test network</h3>
            <p>
              Polygon Amoy is fully public and permanent, but its money is pretend. Moving to
              Polygon's main network would mean deploying the same contracts there, with real
              fees.
            </p>
          </div>
          <div className="faq-item">
            <h3 className="card-title">The screens read a copy</h3>
            <p>
              For speed, pages read the server's copy of the on-chain records, which it updates
              every few seconds. The blockchain stays the source of truth — which is why every
              record can be checked there directly.
            </p>
          </div>
          <div className="faq-item">
            <h3 className="card-title">The truth of what is entered</h3>
            <p>
              The blockchain proves who recorded something and that it hasn't changed since — not
              that it was true. A company could still record a wrong stage; but it would be
              permanently on record, under its own name.
            </p>
          </div>
        </div>
      </Section>

      <Section id="glossary" eyebrow="9 · Glossary" title="The terms, in one line each">
        <dl className="hiw-glossary">
          {GLOSSARY.map(([term, meaning]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{meaning}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <section className="landing-section text-center">
        <Fingerprint size={24} style={{ color: "var(--accent-primary)" }} aria-hidden="true" />
        <h2 style={{ margin: "var(--space-2) 0 var(--space-3)" }}>See the results it produces</h2>
        <p style={{ marginBottom: "var(--space-4)" }}>
          The public results page shows the placement figures built from these records.
        </p>
        <Link to="/results" className="btn btn-primary btn-lg">Placement results</Link>
      </section>
    </div>
  );
}
