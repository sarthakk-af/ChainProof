/**
 * ProjectExplainer.jsx — the plain-language "what is this and how does it work".
 *
 * Shared by LandingPage.jsx (shown to signed-out visitors, above the sign-in
 * form) and the standalone /about route (reachable from the navbar at all
 * times), so there is always a way back to "wait, what am I looking at?".
 *
 * The stats strip reads real numbers from the public API rather than showing
 * invented ones, and deliberately shows no platform-wide placement rate: a rate
 * needs a denominator, and the honest one is per cohort, on the public page.
 */

import React, { useState, useEffect } from "react";
import { GraduationCap, Landmark, Briefcase } from "lucide-react";
import { api } from "../utils/api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { Link } from "../utils/navigation.jsx";

const ROLES = [
  {
    tag: "FOR STUDENTS",
    Icon: GraduationCap,
    title: "Apply, and own your answer",
    body: "Build a resume, apply to the drives you're eligible for, and follow each stage as the company records it. Nothing counts as a placement until you accept the offer yourself.",
  },
  {
    tag: "FOR THE COLLEGE",
    Icon: Landmark,
    title: "Accountable for effort, not just results",
    body: "Confirm your students and the companies that recruit here, host their drives, and keep a permanent record of the training and mock interviews you ran — without ever being able to write a result yourself.",
  },
  {
    tag: "FOR COMPANIES",
    Icon: Briefcase,
    title: "See who's here before you visit",
    body: "Browse the college's students by course, CGPA and skills, post your own terms, and record each candidate's stage. Contact details appear once a student applies to you.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Sign up",
    body: "Email and password — you're in straight away. Students confirm their roll number against the college's roster; companies are approved by the placement cell.",
  },
  {
    n: "02",
    title: "Each party signs its own part",
    body: "The company writes its offer terms and results. The college declares its cohort size and preparation sessions. The student accepts or declines.",
  },
  {
    n: "03",
    title: "The record can't be rewritten",
    body: "Each of those is written to a blockchain the moment it happens. Nobody — not even the administrator — can edit it afterwards.",
  },
  {
    n: "04",
    title: "Anyone can check",
    body: "Funnels, placement figures and the college's preparation record sit on a public page, no login needed, with no individual student named.",
  },
];

function useLiveStats() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    api.get("/public/overview").then(setStats).catch(() => setStats(null));
  }, []);
  return stats;
}

export default function ProjectExplainer() {
  const stats = useLiveStats();
  const { status } = useAuth();
  const signedIn = status === "authenticated";

  return (
    <div className="animate-fade-in-up">
      {/* Hero */}
      <section className="hero-grid landing-section">
        <div>
          <div className="eyebrow-pill" style={{ marginBottom: 16 }}>
            <span className="dot" /> Public record · no login required to check
          </div>
          <h1 className="hero-title">A placement record nobody can fudge.</h1>
          <p className="hero-lead">
            An internal placement platform for one college, where each figure is signed by the
            party with nothing to gain from inflating it — and then can never be changed.
          </p>
          {/* One main action and one alternative. Placement results live in the
              top bar, so they are only offered here as a small link. */}
          {signedIn ? (
            <Link to="/" className="btn btn-primary">Go to your dashboard</Link>
          ) : (
            <>
              <div className="flex gap-12 items-center" style={{ flexWrap: "wrap" }}>
                <Link to="/signup" className="btn btn-primary">Create an account</Link>
                <Link to="/login" className="btn btn-ghost">Sign in</Link>
              </div>
              <p className="form-hint" style={{ marginTop: 12 }}>
                No wallet or crypto knowledge needed. Just want the numbers?{" "}
                <Link to="/results">View placement results</Link>.
              </p>
            </>
          )}

          {/* Real figures from the public API, never invented ones. No overall
              placement rate: a rate needs a denominator, and the honest one is
              per cohort, on the results page. */}
          {stats && (
            <dl className="hero-stats">
              <div><dt>Companies</dt><dd>{stats.companies}</dd></div>
              <div><dt>Drives</dt><dd>{stats.drives}</dd></div>
              <div><dt>Students verified</dt><dd>{stats.students}</dd></div>
              <div><dt>Accepted offers</dt><dd>{stats.placed}</dd></div>
            </dl>
          )}
        </div>

        <div className="ledger-card">
          <div className="ledger-card-head">
            <span>SAMPLE ENTRIES — ILLUSTRATIVE</span>
            <span>#4,281–4,284</span>
          </div>
          <div className="ledger-row">
            <span className="tag">COHORT</span>
            <span className="who">College declared CSE 2026: 180 students</span>
            <span className="hash">0x9f2…c31</span>
          </div>
          <div className="ledger-row">
            <span className="tag">DRIVE</span>
            <span className="who">Company posted SDE, 6.5 LPA, CGPA 7.0+</span>
            <span className="hash">0x7a1…88e</span>
          </div>
          <div className="ledger-row">
            <span className="tag">STAGE</span>
            <span className="who">Company recorded 0x4d0…12f — Offered</span>
            <span className="hash">0x51b…e07</span>
          </div>
          <div className="ledger-row">
            <span className="tag">ACCEPT</span>
            <span className="who">Student 0x4d0…12f accepted the offer</span>
            <span className="stamp-badge">IMMUTABLE</span>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="landing-section">
        <div className="landing-head">
          <h2>How a record gets made</h2>
          <p>It works like any website. The blockchain part happens behind the scenes.</p>
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
      </section>

      {/* Problem / comparison */}
      <section className="landing-section">
        <div className="landing-head">
          <h2>A placement number is only as good as the record behind it.</h2>
          <p>
            "92% placed" means nothing until you know 92% of what, who counted, and whether
            anyone could have changed it since.
          </p>
        </div>
        <div className="compare">
          <div className="compare-col bad">
            <h3>Usually</h3>
            <div className="compare-item bad"><span className="mk">✕</span> The college reports its own results, compiled after the season ends</div>
            <div className="compare-item bad"><span className="mk">✕</span> The batch size behind a percentage can be quietly shrunk</div>
            <div className="compare-item bad"><span className="mk">✕</span> An offer that was made and later withdrawn still gets counted</div>
            <div className="compare-item bad"><span className="mk">✕</span> Nobody outside can check any of it</div>
          </div>
          <div className="compare-col good">
            <h3>With ChainProof</h3>
            <div className="compare-item good"><span className="mk">✓</span> Only the company can record an offer, and only the student can accept it</div>
            <div className="compare-item good"><span className="mk">✓</span> The declared batch size is public, with every revision visible</div>
            <div className="compare-item good"><span className="mk">✓</span> A withdrawn offer takes the student back out of the count</div>
            <div className="compare-item good"><span className="mk">✓</span> Anyone can check it on a public page, no account needed</div>
          </div>
        </div>
      </section>

      {/* Who uses it */}
      <section className="landing-section">
        <div className="landing-head">
          <h2>Three roles, each signing only its own part</h2>
          <p>Parents and anyone else can read the results without an account.</p>
        </div>
        <div className="grid-3" style={{ gap: 14 }}>
          {ROLES.map((r) => (
            <div key={r.title} className="glass-card p-24">
              <div className="flex items-center gap-8" style={{ marginBottom: 8 }}>
                <r.Icon size={18} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
                <span className="section-eyebrow" style={{ margin: 0 }}>{r.tag}</span>
              </div>
              <h3 className="card-title">{r.title}</h3>
              <p style={{ fontSize: "0.84rem" }}>{r.body}</p>
            </div>
          ))}
        </div>
      </section>

      <p className="text-center form-hint">
        The blockchain holds events, not people — names, roll numbers and resumes stay in the
        college's own database.{" "}
        <Link to="/privacy">What is stored, and where →</Link>
      </p>
    </div>
  );
}
