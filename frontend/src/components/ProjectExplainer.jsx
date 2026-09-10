/**
 * ProjectExplainer.jsx — The plain-language "what is this and how does it work" content.
 *
 * Shared by LandingPage.jsx (shown to logged-out visitors, above the sign-in
 * form) and the standalone /about route (reachable from the navbar at all
 * times, logged in or not) — so there is always a way back to "wait, what am
 * I looking at?" without having to sign out.
 *
 * The stats strip pulls real numbers from the public dashboard's own API
 * (no auth needed) rather than showing made-up figures.
 */

import React, { useState, useEffect } from "react";
import { GraduationCap, Landmark, Briefcase } from "lucide-react";
import { api } from "../utils/api.js";

const ROLES = [
  {
    tag: "FOR STUDENTS",
    Icon: GraduationCap,
    title: "Your history, provable to anyone",
    body: "Get linked to your college and watch a permanent timeline build as you get shortlisted, interviewed, and offered — visible to anyone who checks, without a single phone call to verify it.",
  },
  {
    tag: "FOR COLLEGES",
    Icon: Landmark,
    title: "A placement rate that speaks for itself",
    body: "Announce recruiter visits, issue credentials to your own students, and let your placement percentage update itself automatically, straight from that same activity as it happens.",
  },
  {
    tag: "FOR COMPANIES",
    Icon: Briefcase,
    title: "Hiring activity that speaks for itself",
    body: "Move candidates through shortlist, interview, and offer, issuing each step directly — a public, permanent record of how your hiring process actually ran.",
  },
];

const STEPS = [
  { n: "01", title: "Sign up", body: "Email and password. Choose Student, College, or Company — that's the only setup required." },
  { n: "02", title: "Get verified", body: "Colleges and companies are checked by an administrator before they can act. Students skip this — they just name their college." },
  { n: "03", title: "Records get written", body: "A visit, a shortlist, an interview, an offer — each becomes a permanent record the moment it happens." },
  { n: "04", title: "Anyone can check", body: "Placement percentages update automatically and sit on a public page open to everyone, no login." },
];

function useLiveStats() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    api.get("/public/overview").then(setStats).catch(() => setStats(null));
  }, []);
  return stats;
}

export default function ProjectExplainer({ onGetStarted }) {
  const stats = useLiveStats();

  return (
    <div className="animate-fade-in-up">
      {/* Hero */}
      <div className="hero-grid" style={{ display: "grid", gridTemplateColumns: "1.05fr 0.95fr", gap: 48, alignItems: "center", marginBottom: 64 }}>
        <div>
          <div className="eyebrow-pill" style={{ marginBottom: 22 }}>
            <span className="dot" /> Public ledger · no login required to verify
          </div>
          <h1 style={{ marginBottom: 20 }}>Every placement claim, provable.</h1>
          <p style={{ fontSize: "1.05rem", maxWidth: 460, marginBottom: 28 }}>
            Every step of the placement process — an interview, a visit, an offer — is written
            directly by whoever's actually doing it, straight to a shared record that stays
            exactly as it was created.
          </p>
          <div className="flex gap-12" style={{ flexWrap: "wrap" }}>
            {onGetStarted ? (
              <button type="button" className="btn btn-primary btn-lg" onClick={onGetStarted}>
                Create an account
              </button>
            ) : (
              <a href="/" className="btn btn-primary btn-lg">Create an account</a>
            )}
            <a href="/public" className="btn btn-ghost btn-lg">View the public dashboard</a>
          </div>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 16 }}>
            Free to use. No wallet or crypto knowledge needed to sign up.
          </p>
        </div>

        <div className="ledger-card">
          <div className="ledger-card-head">
            <span>SAMPLE COLLEGE — ILLUSTRATIVE ENTRIES</span>
            <span>#4,281–4,284</span>
          </div>
          <div className="ledger-row">
            <span className="tag">REGISTER</span>
            <span className="who">A. Verma joined as Student</span>
            <span className="hash">0x9f2…c31</span>
          </div>
          <div className="ledger-row">
            <span className="tag">VISIT</span>
            <span className="who">College announced a company visit</span>
            <span className="hash">0x7a1…88e</span>
          </div>
          <div className="ledger-row">
            <span className="tag">CREDENTIAL</span>
            <span className="who">Company marked A. Verma — Interviewed</span>
            <span className="hash">0x4d0…12f</span>
          </div>
          <div className="ledger-row">
            <span className="tag">CREDENTIAL</span>
            <span className="who">Company marked A. Verma — Offer</span>
            <span className="stamp-badge">IMMUTABLE</span>
          </div>
        </div>
      </div>

      {/* Problem / comparison */}
      <div style={{ marginBottom: 64 }}>
        <div style={{ maxWidth: 620, marginBottom: 24 }}>
          <h2 style={{ marginBottom: 8 }}>A placement number is only as good as the record behind it.</h2>
          <p style={{ fontSize: "0.92rem" }}>
            There's a real difference between a number compiled after the fact and one built
            directly from a permanent record, as it happens — and today, almost nobody has
            access to the second kind.
          </p>
        </div>
        <div className="compare">
          <div className="compare-col bad">
            <h3>Before ChainProof</h3>
            <div className="compare-item bad"><span className="mk">✕</span> Placement activity lives across many separate conversations and spreadsheets</div>
            <div className="compare-item bad"><span className="mk">✕</span> There's no easy way to independently verify a placement claim afterward</div>
            <div className="compare-item bad"><span className="mk">✕</span> The final percentage depends on manual compilation, gathered after the fact</div>
            <div className="compare-item bad"><span className="mk">✕</span> No outside party has a simple way to check the underlying activity</div>
          </div>
          <div className="compare-col good">
            <h3>With ChainProof</h3>
            <div className="compare-item good"><span className="mk">✓</span> Every step — a visit, a shortlist, an offer — is written directly by whoever did it</div>
            <div className="compare-item good"><span className="mk">✓</span> A student's full history stays visible in one place, offer or not</div>
            <div className="compare-item good"><span className="mk">✓</span> The percentage is calculated automatically from that same activity</div>
            <div className="compare-item good"><span className="mk">✓</span> Anyone can check it on a public page, no account needed</div>
          </div>
        </div>
      </div>

      {/* How it works */}
      <div style={{ marginBottom: 64 }}>
        <div style={{ maxWidth: 620, marginBottom: 32 }}>
          <h2 style={{ marginBottom: 8 }}>How a record gets made</h2>
          <p style={{ fontSize: "0.92rem" }}>No wallet, no crypto knowledge — it works like any website. The blockchain part happens behind the scenes.</p>
        </div>
        <div className="steps-grid">
          {STEPS.map((s) => (
            <div key={s.n} className="step-col">
              <span className="num">{s.n}</span>
              <h4>{s.title}</h4>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Who uses it */}
      <div style={{ marginBottom: 64 }}>
        <div style={{ maxWidth: 620, marginBottom: 24 }}>
          <h2 style={{ marginBottom: 8 }}>Built for three kinds of people</h2>
          <p style={{ fontSize: "0.92rem" }}>Each role sees a different dashboard, but writes to the same permanent record.</p>
        </div>
        <div className="grid-3 stagger-children">
          {ROLES.map((r) => (
            <div key={r.title} className="glass-card p-24 animate-fade-in-up">
              <r.Icon size={24} style={{ color: "var(--accent-primary)" }} />
              <div className="section-eyebrow" style={{ marginTop: 10 }}>{r.tag}</div>
              <h3 style={{ margin: "10px 0" }}>{r.title}</h3>
              <p style={{ fontSize: "0.85rem" }}>{r.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Real stats */}
      {stats && (
        <div style={{ marginBottom: 64 }}>
          <div className="stats-strip">
            <div className="stat-item">
              <span className="stat-n">{stats.totalColleges}</span>
              <span className="stat-l">Colleges verified and active</span>
            </div>
            <div className="stat-item">
              <span className="stat-n">{stats.totalStudents}</span>
              <span className="stat-l">Students registered on-chain</span>
            </div>
            <div className="stat-item">
              <span className="stat-n">{stats.totalPlaced}</span>
              <span className="stat-l">Students placed, verifiably</span>
            </div>
            <div className="stat-item">
              <span className="stat-n">{stats.overallPlacementPercentage}%</span>
              <span className="stat-l">Real placement rate, calculated live</span>
            </div>
          </div>
        </div>
      )}

      {/* What makes it trustworthy */}
      <div className="grid-2" style={{ gap: 16 }}>
        <div className="glass-card p-24">
          <h3 style={{ marginBottom: 8, fontSize: "1rem" }}>A Complete, Open History</h3>
          <p style={{ fontSize: "0.85rem" }}>
            Every action stays visible permanently. If something changes later, it's reflected
            with a new, clearly linked record — the full history stays right there alongside it.
          </p>
        </div>
        <div className="glass-card p-24">
          <h3 style={{ marginBottom: 8, fontSize: "1rem" }}>Numbers, Not Guesswork</h3>
          <p style={{ fontSize: "0.85rem" }}>
            Placement percentages are calculated automatically from real, recorded activity —
            always kept in sync as new records are added.
          </p>
        </div>
      </div>

      <p className="text-center" style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
        Curious what "permanent record" actually means for your data?{" "}
        <a href="/privacy">Read the Privacy &amp; Data page →</a>
      </p>
    </div>
  );
}
