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
    title: "Apply to every drive, and answer your own offers",
    body: "Build a resume, apply to the drives you're eligible for, and follow each stage as the company records it. Nothing counts as a placement until you accept the offer yourself.",
  },
  {
    tag: "FOR THE COLLEGE",
    Icon: Landmark,
    title: "Show the work behind your placement numbers",
    body: "Confirm your students and the companies that recruit here, host their drives, and keep a permanent record of the training and mock interviews you ran — without ever being able to write a result yourself.",
  },
  {
    tag: "FOR COMPANIES",
    Icon: Briefcase,
    title: "See who is here before you visit",
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
    body: "The company writes its offer terms and results. The college declares its batch size and preparation sessions. The student accepts or declines.",
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

/**
 * The real numbers, read from the public API.
 *
 * The hero used to hold a hand-drawn ledger of invented rows labelled
 * ILLUSTRATIVE — made-up data on a page whose entire claim is that its data
 * cannot be made up. This is the same idea with the actual record behind it,
 * and when there is no season yet it says so instead of showing zeros dressed
 * up as achievement.
 */
function useRecord() {
  const [record, setRecord] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const overview = await api.get("/public/overview");
        const { colleges } = await api.get("/public/colleges");
        const college = colleges?.[0] ?? null;
        let batch = null;
        if (college) {
          const placement = await api.get(`/public/colleges/${college.address}/placement`);
          batch = (placement.batches ?? []).slice().sort((a, b) => b.batchYear - a.batchYear)[0] ?? null;
        }
        if (!cancelled) setRecord({ overview, college, batch });
      } catch {
        if (!cancelled) setRecord(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return record;
}

function LiveRecord({ record }) {
  // Nothing at all until the figures arrive: an empty frame that then fills is
  // worse than a moment of nothing.
  if (!record) return null;
  const { college, batch, overview } = record;
  const hasSeason = !!college && !!batch && batch.declaredStrength > 0;

  // Before a college exists there is genuinely nothing to show, and saying so
  // is better than a hero with one empty half.
  if (!college) {
    return (
      <div className="record-card">
        <div className="record-head">
          <span>The public record</span>
          <span>Not started</span>
        </div>
        <p className="record-note" style={{ marginTop: "var(--space-4)" }}>
          No college is set up here yet. Once one is, this shows its real figures — how many
          students it declared, how many were placed, and which companies recruited.
        </p>
      </div>
    );
  }

  return (
    <div className="record-card">
      <div className="record-head">
        <span>{college.name}</span>
        <span>The public record</span>
      </div>

      {hasSeason ? (
        <>
          <div className="record-figure">
            <span className="record-number">{batch.placed}</span>
            <span className="record-of">of {batch.declaredStrength} placed</span>
          </div>
          <p className="record-note">
            Batch {batch.batchYear} · {batch.registered} signed up here ·{" "}
            {overview.companies} {overview.companies === 1 ? "company" : "companies"} recruiting
          </p>
        </>
      ) : (
        <>
          <div className="record-figure">
            <span className="record-number">{overview.companies}</span>
            <span className="record-of">
              {overview.companies === 1 ? "company admitted" : "companies admitted"}
            </span>
          </div>
          <p className="record-note">
            No placement season recorded yet. Every figure here is written by the party it
            belongs to, as it happens.
          </p>
        </>
      )}

      <Link to="/results" className="record-link">See the whole record →</Link>
    </div>
  );
}

export default function ProjectExplainer() {
  const record = useRecord();
  const { status } = useAuth();
  const signedIn = status === "authenticated";

  return (
    <div className="animate-fade-in-up">
      {/* Hero */}
      <section className="hero-grid landing-section">
        <div>
          <div className="eyebrow-pill" style={{ marginBottom: "var(--space-4)" }}>
            <span className="dot" /> Public record · no login required to check
          </div>
          <h1 className="hero-title">Placement results you can check, not take on trust.</h1>
          <p className="hero-lead">
            Every offer is recorded by the company that made it, and every acceptance by the
            student. Nobody can edit it afterwards — including the college.
          </p>

          {/* One action. Sign in is for people who already have an account, so it
              is a quiet link rather than a second button competing with it. */}
          {signedIn ? (
            <Link to="/" className="btn btn-primary btn-lg">Go to your dashboard</Link>
          ) : (
            <>
              <div className="flex gap-12 items-center" style={{ flexWrap: "wrap" }}>
                <Link to="/signup" className="btn btn-primary btn-lg">Create an account</Link>
                <Link to="/login" className="link-quiet">or sign in</Link>
              </div>
              {/* Each reader gets one line naming what they came for. */}
              <ul className="hero-roles">
                <li><strong>Student</strong> — apply to drives and answer your own offers</li>
                <li><strong>Placement cell</strong> — admit companies, host drives, confirm students</li>
                <li><strong>Company</strong> — post a drive and record who you selected</li>
                <li>
                  <strong>Just checking?</strong> <Link to="/results">See the results</Link> — no account needed
                </li>
              </ul>
            </>
          )}
        </div>

        <LiveRecord record={record} />
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
        <div className="grid-3" style={{ gap: "var(--space-3)" }}>
          {ROLES.map((r) => (
            <div key={r.title} className="glass-card p-24">
              <div className="flex items-center gap-8" style={{ marginBottom: "var(--space-2)" }}>
                <r.Icon size={18} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
                <span className="section-eyebrow" style={{ margin: 0 }}>{r.tag}</span>
              </div>
              <h3 className="card-title">{r.title}</h3>
              <p style={{ fontSize: "var(--text-sm)" }}>{r.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* The four things people actually hesitate over, answered where they
          hesitate rather than on a page nobody opens. */}
      <section className="landing-section">
        <div className="landing-head">
          <h2>Questions people ask</h2>
        </div>
        <div className="faq">
          <div className="faq-item">
            <h3 className="card-title">Is my personal information public?</h3>
            <p>
              No. The blockchain holds events, not people: a wallet address, a package, a
              date. Your name, email, phone and resume stay in your college's own database.
              The public results page names companies, never students.
            </p>
          </div>
          <div className="faq-item">
            <h3 className="card-title">Do I need crypto, a wallet or any money?</h3>
            <p>
              No. You sign up with an email address and a password like any other site. The
              account gets a wallet behind the scenes, and the college pays the few rupees of
              network cost. You will never see it.
            </p>
          </div>
          <div className="faq-item">
            <h3 className="card-title">Who can see my resume?</h3>
            <p>
              Companies admitted by your placement cell can browse students without names —
              course, batch, CGPA, skills and what you wrote. Your name and contact details
              appear to a company only once you apply to its drive.
            </p>
          </div>
          <div className="faq-item">
            <h3 className="card-title">What if my roll number isn't on the roster?</h3>
            <p>
              You can still sign up and look around. Your request waits with the placement
              cell, and they confirm you by hand — being early is not a dead end.
            </p>
          </div>
        </div>
      </section>

      {/* Who made this, and where it stands. A college deploying a tool has a
          right to know both, and the honest version is short. */}
      <section className="landing-section">
        <div className="glass-card p-24">
          <h3 className="card-title">Who built this</h3>
          <p style={{ fontSize: "var(--text-sm)", marginTop: "var(--space-2)" }}>
            ChainProof was built by Sarthak Bhalchandra Gupta as a college project, and is
            maintained by him. It currently runs on a private test blockchain — no real money
            is involved anywhere, and nothing is deployed publicly yet. Questions about your
            own data go to your placement cell, who can reach the maintainer.
          </p>
        </div>
      </section>

      {!signedIn && (
        <section className="landing-section text-center">
          <h2 style={{ marginBottom: "var(--space-3)" }}>Ready to start?</h2>
          <p style={{ marginBottom: "var(--space-4)" }}>
            It takes an email address and a password.
          </p>
          <Link to="/signup" className="btn btn-primary btn-lg">Create an account</Link>
        </section>
      )}

      <p className="text-center form-hint">
        The blockchain holds events, not people — names, roll numbers and resumes stay in the
        college's own database.{" "}
        <Link to="/privacy">What is stored, and where →</Link>
      </p>
    </div>
  );
}
