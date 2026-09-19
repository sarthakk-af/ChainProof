/**
 * SiteFooter.jsx — the same footer under every page a visitor can reach
 * without signing in.
 *
 * It used to exist only on the landing page, so /about, /privacy and the
 * public results page simply stopped at the last sentence with nowhere to go.
 * Kept short on purpose: three links people actually want, and one line saying
 * what this is. A footer full of empty gestures is worse than a small one.
 */

import React from "react";
import { Link } from "../utils/navigation.jsx";

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div>
          <div className="site-footer-brand">ChainProof</div>
          <p className="site-footer-line">
            The placement record for one college. Written by the companies, the college and the
            students themselves — and permanent once written.
          </p>
        </div>

        <nav className="site-footer-links" aria-label="Footer">
          <Link to="/results">Placement results</Link>
          <Link to="/about">How it works</Link>
          <Link to="/privacy">Privacy &amp; data</Link>
          {/* Reaching the footer of the long explainer means a lot of
              scrolling; this is the way back without doing it again. */}
          <button
            type="button"
            className="btn-link-quiet"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          >
            Back to top ↑
          </button>
        </nav>
      </div>
    </footer>
  );
}
