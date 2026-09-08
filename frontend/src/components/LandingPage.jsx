/**
 * LandingPage.jsx — The default view for anyone not signed in.
 *
 * Explains the whole project first (ProjectExplainer.jsx). Clicking
 * "Create an account" swaps the explainer out for the actual sign-in/up
 * form — one entry point, not a button up top that just scrolls to a second
 * copy of the same form further down the page.
 */

import React, { useState } from "react";
import ProjectExplainer from "./ProjectExplainer.jsx";
import AuthScreen from "./AuthScreen.jsx";

export default function LandingPage() {
  const [showForm, setShowForm] = useState(false);

  const openForm = () => {
    setShowForm(true);
    window.scrollTo(0, 0);
  };

  return (
    <div className="page-container" style={{ maxWidth: showForm ? 480 : 1160 }}>
      {showForm ? (
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)} style={{ marginBottom: 24 }}>
            ← Back
          </button>
          <AuthScreen initialMode="signup" />
        </>
      ) : (
        <>
          <ProjectExplainer onGetStarted={openForm} />

          <footer style={{ borderTop: "1px solid var(--border-glow)", marginTop: 64, padding: "32px 0 8px" }}>
            <div className="flex items-center justify-between" style={{ flexWrap: "wrap", gap: 16 }}>
              <span style={{ fontFamily: "var(--font-head)", fontSize: "1.05rem" }}>ChainProof</span>
              <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                Public ledger of student placements · records are permanent
              </span>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}
