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
      <div className="hero-grid" style={{ display: "grid", gridTemplateColumns: "1.05fr 0.95fr", gap: 48, alignItems: "center", marginBottom: 64 }}>
        <div>
          <div className="eyebrow-pill" style={{ marginBottom: 22 }}>
            <span className="dot" /> Public record · no login required to check
          </div>
          <h1 style={{ marginBottom: 20 }}>A placement record nobody can fudge.</h1>
          <p style={{ fontSize: "1.05rem", maxWidth: 460, marginBottom: 28 }}>
            An internal placement platform for one college, where each figure is signed by the
            party with nothing to gain from inflating it — and then can never be changed.
          </p>
          {/* One main action and one alternative. Placement results live in the
              top bar, so they are not repeated here. */}
          {signedIn ? (
            <Link to="/" className="btn btn-primary btn-lg">Go to your dashboard</Link>
          ) : (
            <>
              <div className="flex gap-12 items-center" style={{ flexWrap: "wrap" }}>
                <Link to="/signup" className="btn btn-primary btn-lg">Create an account</Link>
                <Link to="/login" className="btn btn-ghost btn-lg">Sign in</Link>
              </div>
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 16 }}>
                No wallet or crypto knowledge needed. Just want to see the numbers?{" "}
                <Link to="/results">View placement results</Link>.
              </p>
            </>
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
      </div>

      {/* Problem / comparison */}
      <div style={{ marginBottom: 64 }}>
        <div style={{ maxWidth: 620, marginBottom: 24 }}>
          <h2 style={{ marginBottom: 8 }}>A placement number is only as good as the record behind it.</h2>
          <p style={{ fontSize: "0.92rem" }}>
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
      </div>

      {/* How it works */}
      <div style={{ marginBottom: 64 }}>
        <div style={{ maxWidth: 620, marginBottom: 32 }}>
          <h2 style={{ marginBottom: 8 }}>How a record gets made</h2>
          <p style={{ fontSize: "0.92rem" }}>It works like any website. The blockchain part happens behind the scenes.</p>
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
          <h2 style={{ marginBottom: 8 }}>Three roles, each signing only its own part</h2>
          <p style={{ fontSize: "0.92rem" }}>Parents and anyone else can read the result without an account.</p>
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
              <span className="stat-n">{stats.companies}</span>
              <span className="stat-l">Companies approved to recruit</span>
            </div>
            <div className="stat-item">
              <span className="stat-n">{stats.drives}</span>
              <span className="stat-l">Drives posted</span>
            </div>
            <div className="stat-item">
              <span className="stat-n">{stats.students}</span>
              <span className="stat-l">Students verified</span>
            </div>
            <div className="stat-item">
              <span className="stat-n">{stats.placed}</span>
              <span className="stat-l">Students who accepted an offer</span>
            </div>
          </div>
        </div>
      )}

      {/* What makes it trustworthy */}
      <div className="grid-2" style={{ gap: 16, marginBottom: 24 }}>
        <div className="glass-card p-24">
          <h3 style={{ marginBottom: 8, fontSize: "1rem" }}>Mistakes stay visible</h3>
          <p style={{ fontSize: "0.85rem" }}>
            A withdrawn offer, a revised batch size, a session that didn't happen — each is a
            new entry beside the original, never an edit that hides it.
          </p>
        </div>
        <div className="glass-card p-24">
          <h3 style={{ marginBottom: 8, fontSize: "1rem" }}>People stay private</h3>
          <p style={{ fontSize: "0.85rem" }}>
            The blockchain holds events, not people. Names, roll numbers and resumes stay in the
            college's own database, and companies browse students without seeing who they are.
          </p>
        </div>
      </div>

      <p className="text-center" style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
        Want to know exactly what is stored, and where?{" "}
        <Link to="/privacy">Read the Privacy &amp; Data page →</Link>
      </p>
    </div>
  );
}
