/**
 * PendingApproval.jsx — Shown to a College/Company waiting on admin verification.
 *
 * A Rejected actor can resubmit (the backend/contract both allow this — see
 * ActorRegistry.sol's `register` and routes/me.js's registration check), so
 * this owns a small "try again" sub-flow: clicking through swaps in the same
 * Registration form used for a first-time signup. Once the resubmission goes
 * through, `actor.status` flips to Pending and this naturally falls back to
 * the pending message instead of the rejected one.
 */

import React, { useState, useEffect } from "react";
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
    <div className="page-container animate-fade-in-up text-center" style={{ maxWidth: 560, marginTop: 100 }}>
      <div style={{ fontSize: "3.5rem", marginBottom: 16 }}>{isRejected ? "❌" : "⏳"}</div>
      <h2 style={{ marginBottom: 12 }}>
        {isRejected ? "Registration Rejected" : "Verification Pending"}
      </h2>
      <p style={{ marginBottom: 28 }}>
        {isRejected ? (
          <>
            Your registration as <strong>{actor?.name}</strong> was reviewed and not approved.
            {actor?.rejectionReason && (
              <>
                {" "}The administrator's note: <em>"{actor.rejectionReason}"</em>
              </>
            )}{" "}
            You're welcome to submit a corrected application below.
          </>
        ) : (
          <>
            Thanks for registering, <strong>{actor?.name}</strong>. A platform administrator
            confirms every college and company on the platform is genuinely who they say they
            are before they can issue credentials or announce visits — a quick check that
            applies equally to everyone.
          </>
        )}
      </p>
      <div className="flex justify-center gap-12">
        {isRejected ? (
          <button className="btn btn-primary" onClick={() => setResubmitting(true)}>
            🔄 Try Again
          </button>
        ) : (
          <button className="btn btn-secondary" onClick={() => refreshActor()}>
            🔄 Check Again
          </button>
        )}
        <button className="btn btn-ghost" onClick={logout}>
          Sign Out
        </button>
      </div>
    </div>
  );
}
