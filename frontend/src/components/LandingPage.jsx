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
    </div>
  );
}
