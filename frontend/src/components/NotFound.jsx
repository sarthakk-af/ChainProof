/**
 * NotFound.jsx — for an address that does not exist.
 *
 * There was no such page at all: an unknown path quietly rendered the landing
 * page when signed out, and the dashboard when signed in. A mistyped or stale
 * link therefore looked like it had worked, which is worse than an error —
 * nobody goes looking for a problem the screen says they do not have.
 *
 * Deliberately plain. Somebody arrived here by accident; the job is to get
 * them out, not to entertain them.
 */

import React from "react";
import { FileQuestion } from "lucide-react";
import { Link } from "../utils/navigation.jsx";
import { useAuth } from "../context/AuthContext.jsx";

export default function NotFound() {
  const { status } = useAuth();
  const signedIn = status === "authenticated";

  return (
    <div className="page-container page-status animate-fade-in-up">
      <FileQuestion size={40} style={{ color: "var(--text-muted)", marginBottom: "var(--space-4)" }} />
      <h2 style={{ marginBottom: "var(--space-3)" }}>That page doesn&apos;t exist</h2>
      <p style={{ marginBottom: "var(--space-5)" }}>
        The address you followed isn&apos;t part of ChainProof. It may have been mistyped, or it
        may be an old link to something that has moved.
      </p>

      <div className="flex gap-12 justify-center" style={{ flexWrap: "wrap" }}>
        <Link to="/" className="btn btn-primary">{signedIn ? "Go to your dashboard" : "Go to the home page"}</Link>
        <Link to="/results" className="btn btn-ghost">Placement results</Link>
        {!signedIn && <Link to="/login" className="btn btn-ghost">Sign in</Link>}
      </div>
    </div>
  );
}
