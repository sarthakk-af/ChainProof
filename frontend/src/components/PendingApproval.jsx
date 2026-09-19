/**
 * PendingApproval.jsx — Shown to a company waiting for the college to admit it.
 *
 * Only companies reach this screen: a college is created already active by the
 * platform administrator, and a student is written on-chain only once verified.
 *
 * A Rejected actor can resubmit (the backend/contract both allow this — see
 * ActorRegistry.sol's `register` and routes/me.js's registration check), so
 * this owns a small "try again" sub-flow: clicking through swaps in the same
 * Registration form used for a first-time signup. Once the resubmission goes
 * through, `actor.status` flips to Pending and this naturally falls back to
 * the pending message instead of the rejected one.
 */

import React, { useState, useEffect } from "react";
import { XCircle, Clock, RefreshCw, LogOut } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import Registration from "./Registration.jsx";

export default function PendingApproval() {
  const { actor, logout, refreshActor } = useAuth();
  const isRejected = actor?.status === "Rejected";
  const [resubmitting, setResubmitting] = useState(false);

  // If status moves away from Rejected (resubmitted, or rejected again later
  // after being re-reviewed), don't carry a stale "resubmitting" flag forward.
  useEffect(() => {
    if (!isRejected) setResubmitting(false);
  }, [isRejected]);

  if (isRejected && resubmitting) {
    return <Registration />;
  }

  return (
    <div className="page-container page-status animate-fade-in-up">
      {isRejected ? (
        <XCircle size={40} style={{ color: "var(--accent-danger)", marginBottom: "var(--space-4)" }} />
      ) : (
        <Clock size={40} style={{ color: "var(--accent-warning)", marginBottom: "var(--space-4)" }} />
      )}
      <h2 style={{ marginBottom: "var(--space-3)" }}>
        {isRejected ? "Registration rejected" : "Verification pending"}
      </h2>
      <p style={{ marginBottom: "var(--space-5)" }}>
        {isRejected ? (
          <>
            Your registration as <strong>{actor?.name}</strong> was reviewed and not approved.
            {actor?.rejectionReason && (
              <>
                {" "}The placement cell's note: <em>"{actor.rejectionReason}"</em>
              </>
            )}{" "}
            You're welcome to submit a corrected application below.
          </>
        ) : (
          <>
            Thanks for registering, <strong>{actor?.name}</strong>. The college's placement
            cell confirms every company recruiting on its campus before that company can post
            a drive or browse students — a quick check that applies equally to everyone.
          </>
        )}
      </p>
      <div className="flex justify-center gap-12">
        {isRejected ? (
          <button className="btn btn-primary" onClick={() => setResubmitting(true)}>
            <RefreshCw size={16} /> Try again
          </button>
        ) : (
          <button className="btn btn-secondary" onClick={() => refreshActor()}>
            <RefreshCw size={16} /> Check again
          </button>
        )}
        <button className="btn btn-ghost" onClick={logout}>
          <LogOut size={16} /> Sign out
        </button>
      </div>
    </div>
  );
}
