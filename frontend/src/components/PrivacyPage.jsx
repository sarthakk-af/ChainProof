/**
 * PrivacyPage.jsx — plain-language explanation of what this app keeps, where,
 * and who can see it.
 *
 * Reachable at /privacy at all times. Not a legal document — it is an honest
 * account of the trade-offs, written for someone who isn't a blockchain person.
 * It has to stay true to the code: a privacy page that describes an older
 * version of the app is worse than none.
 */
import React from "react";
import { Link2, HardDrive, Eye, Scale, Lock } from "lucide-react";

function SectionHeading({ Icon, children }) {
  return (
    <h3 style={{ marginBottom: "var(--space-2)", display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
      <Icon size={18} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
      {children}
    </h3>
  );
}

export default function PrivacyPage() {
  return (
    <div className="page-container animate-fade-in-up" style={{ maxWidth: 760 }}>
      <div className="section-eyebrow">Privacy &amp; Data</div>
      <h2 style={{ marginBottom: "var(--space-2)" }}>What this app stores, and who sees it</h2>
      <p style={{ marginBottom: "var(--space-6)" }}>
        A plain-language explanation, not a legal document. The short version: the record of
        the placement season is permanent and public; everything about you as a person is
        not.
      </p>

      <div className="glass-card p-24" style={{ marginBottom: "var(--space-4)" }}>
        <SectionHeading Icon={Link2}>What goes on the blockchain — and never comes off</SectionHeading>
        <p style={{ marginBottom: "var(--space-2)" }}>
          The facts of the placement season: which companies came, the terms they offered,
          how many applied, each recruitment stage, whether an offer was accepted, the size of
          each batch, and the preparation sessions the college ran. That permanence is the
          point — a record nobody can quietly edit later is what makes it worth trusting.
        </p>
        <p style={{ margin: 0 }}>
          For a student, the blockchain holds only a wallet address.{" "}
          <strong>Your name, roll number, CGPA and resume are never written there</strong>, so
          nothing about you as a person becomes permanent. Colleges and companies are
          registered under their own names, because those are public organisations.
        </p>
      </div>

      <div className="glass-card p-24" style={{ marginBottom: "var(--space-4)" }}>
        <SectionHeading Icon={HardDrive}>What stays off-chain — and can be changed or deleted</SectionHeading>
        <p style={{ marginBottom: "var(--space-2)" }}>
          Your email, your password (stored only as a hash), your roll number and the details
          your college's roster holds, your resume, your skills, and the list of drives you
          applied to all live in this app's own database.
        </p>
        <p style={{ margin: 0 }}>
          You can edit your resume whenever you like. Placement notices are off-chain too, which
          is why they can be edited or withdrawn — an edited notice is always marked as edited.
        </p>
      </div>

      <div className="glass-card p-24" style={{ marginBottom: "var(--space-4)" }}>
        <SectionHeading Icon={Eye}>Who can see what</SectionHeading>
        <ul style={{ margin: 0, paddingLeft: "var(--space-4)", lineHeight: 1.8 }}>
          <li>
            <strong>Companies</strong> can browse this college's students by course, batch,
            CGPA and skills — without names, emails or phone numbers. Your contact details
            reach a company only when you apply to one of its drives.
          </li>
          <li>
            <strong>Other students</strong> can open your profile only if they know both your
            roll number and the email you signed up with.
          </li>
          <li>
            <strong>Your college</strong> sees its own roster and the verification requests
            sent to it.
          </li>
          <li>
            <strong>The public</strong> sees totals and funnels only — never an individual.
          </li>
          <li>
            <strong>The administrator</strong> can suspend an account, but cannot read your
            password or change anything already recorded.
          </li>
        </ul>
      </div>

      {/* The security questions people ask about a site that holds their
          details, answered plainly. No certification badges: this project holds
          none, and a borrowed logo on a page about unfakeable records would be
          the joke writing itself. */}
      <div className="glass-card p-24" style={{ marginBottom: "var(--space-4)" }}>
        <SectionHeading Icon={Lock}>How your account is protected</SectionHeading>
        <ul className="plain-list">
          <li>
            <strong>Your password</strong> is stored as a bcrypt hash. Nobody — including
            whoever runs this — can read it back.
          </li>
          <li>
            <strong>Your wallet key</strong> is encrypted (AES-256-GCM) and decrypted only for
            the instant a transaction is signed.
          </li>
          <li>
            <strong>Your session</strong> can be ended everywhere from the Account page, and
            changing your password ends every other session by itself.
          </li>
          <li>
            <strong>The administrator</strong> can suspend an account. They cannot edit or
            delete anything that was recorded, and the platform is built so that they can't.
          </li>
          <li>
            <strong>Where it lives:</strong> the database sits on the college's own machine.
            The blockchain record is public by design; everything above is not on it.
          </li>
        </ul>
        <p className="form-hint" style={{ marginTop: "var(--space-3)" }}>
          Found a security problem? Tell the placement cell, and they will pass it to whoever
          maintains this. There is no bug bounty and no third-party audit — this is a college
          project, and saying otherwise would be the sort of claim the rest of this page argues
          against.
        </p>
      </div>

      <div className="glass-card p-24">
        <SectionHeading Icon={Scale}>The trade-off, honestly</SectionHeading>
        <p style={{ margin: 0 }}>
          Data protection law (India's DPDP Act, and similar rules elsewhere) expects people to
          be able to have their personal data erased, and a public blockchain cannot erase
          anything. That is exactly why personal details are kept off it. What remains on-chain
          is a record of events tied to a wallet address, which says nothing about who you are
          to anyone who doesn't already have access to this app's database.
        </p>
      </div>
    </div>
  );
}
