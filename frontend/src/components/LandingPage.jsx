/**
 * LandingPage.jsx — the home page for anyone not signed in.
 *
 * Only the explanation of the project. Signing in and creating an account are
 * separate pages (/login and /signup) with their own addresses, reached from
 * the top bar or the buttons below. They used to appear in place of this page
 * with no change of address, which left no way to go straight to "Sign in" and
 * made the browser's Back button leave the site.
 */

import React from "react";
import ProjectExplainer from "./ProjectExplainer.jsx";

export default function LandingPage() {
  return (
    <div className="page-container" style={{ maxWidth: 1160 }}>
      <ProjectExplainer />

      <footer style={{ borderTop: "1px solid var(--border-glow)", marginTop: 8, padding: "20px 0 0" }}>
        <div className="flex items-center justify-between" style={{ flexWrap: "wrap", gap: 16 }}>
          <span style={{ fontFamily: "var(--font-head)", fontSize: "1.05rem" }}>ChainProof</span>
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            Public ledger of student placements · records are permanent
          </span>
        </div>
      </footer>
    </div>
  );
}
