/**
 * PrivacyPage.jsx — Plain-language explanation of what data this app keeps,
 * where, and the real tension between "permanent, verifiable record" (the
 * whole point of the project) and a user's usual expectation of being able
 * to delete their data later.
 *
 * Reachable at /privacy at all times, same plain-pathname pattern as /about —
 * this isn't a binding legal document (that would need an actual lawyer and
 * a live, funded product to make sense), it's an honest explanation of the
 * tradeoffs, written for someone who isn't a blockchain person.
 */
import React from "react";
import { Link2, HardDrive, Scale, Globe } from "lucide-react";

function SectionHeading({ Icon, children }) {
  return (
    <h3 style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
      <Icon size={18} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
      {children}
    </h3>
  );
}

export default function PrivacyPage() {
  return (
    <div className="page-container animate-fade-in-up" style={{ maxWidth: 760 }}>
      <div className="section-eyebrow">Privacy &amp; Data</div>
      <h2 style={{ marginBottom: 8 }}>What This App Stores, and Why It's Different</h2>
      <p style={{ marginBottom: 32 }}>
        This is a plain-language explanation, not a legal document — this project is a local demo,
        not a live product with real users to protect. But the underlying tension is real, and worth
        understanding honestly rather than glossing over.
      </p>

      <div className="glass-card p-24" style={{ marginBottom: 20 }}>
        <SectionHeading Icon={Link2}>What goes on the blockchain — and never comes off</SectionHeading>
        <p style={{ marginBottom: 8 }}>
          Your role, name, college link, and every credential (a shortlist, an interview, an offer)
          are written to the blockchain. That's the entire point: a record that can't be quietly
          edited or deleted later is what makes it trustworthy to someone who wasn't there when it
          happened.
        </p>
        <p style={{ margin: 0 }}>
          The flip side: <strong>it genuinely cannot be deleted</strong>, by you or by us. A mistake
          gets <em>corrected</em> — a new record explicitly superseding the old one — but the original
          stays visible, permanently, alongside the correction. There's no "erase my account" button
          that could ever fully work here, and it would be dishonest to pretend otherwise.
        </p>
      </div>

      <div className="glass-card p-24" style={{ marginBottom: 20 }}>
        <SectionHeading Icon={HardDrive}>What stays off-chain — and can be deleted</SectionHeading>
        <p style={{ marginBottom: 8 }}>
          Your email address and password (hashed, never stored in plain text) live in this app's own
          database, not on the blockchain. So does a local cache of on-chain data, kept only so the
          app doesn't have to re-read the blockchain on every click.
        </p>
        <p style={{ margin: 0 }}>
          This part <em>can</em> be deleted — closing this local deployment, or wiping its database
          file, removes it. It's just not the part that makes the placement record verifiable.
        </p>
      </div>

      <div className="glass-card p-24" style={{ marginBottom: 20 }}>
        <SectionHeading Icon={Scale}>The real tension: permanence vs. "right to erasure"</SectionHeading>
        <p style={{ marginBottom: 8 }}>
          Data protection law (India's DPDP Act, and similar rules elsewhere) generally expects a
          person to be able to ask for their personal data to be deleted. A public, immutable ledger
          structurally can't fully honor that for anything already written to it — this is a known,
          debated limitation of blockchain-based systems in general, not something specific to this
          project or something we're claiming to have solved.
        </p>
        <p style={{ margin: 0 }}>
          A production version of something like this would need to think carefully about what
          actually goes on-chain (perhaps just a hash or reference, with the real personal data kept
          off-chain and genuinely deletable) rather than putting names and identifying details
          directly into permanent storage the way this demo does for simplicity.
        </p>
      </div>

      <div className="glass-card p-24">
        <SectionHeading Icon={Globe}>About the credential metadata (IPFS)</SectionHeading>
        <p style={{ margin: 0 }}>
          Each credential's title and description are stored via IPFS — either genuinely uploaded to
          the public IPFS network (if configured), or kept as a local browser-only placeholder
          otherwise. See the "How It Works" page for what that means for verifiability specifically.
        </p>
      </div>
    </div>
  );
}
