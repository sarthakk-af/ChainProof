/**
 * ConfirmEmail.jsx — where a signed-in account types the code we emailed it.
 *
 * Signing up signs you straight in, so the sign-up page's own code form was
 * never seen: the app moved the new account on to its next step before that
 * form could appear. Nothing else on any screen took the code. A student was
 * told to "confirm your email using the code we sent you" and given nowhere to
 * type it — and without a confirmed email they are never verified, so they can
 * never apply. This card is that missing place, shown wherever the account is
 * still waiting on it.
 */

import React, { useEffect, useState } from "react";
import { Mail, AlertCircle } from "lucide-react";
import { useAuth } from "../../context/AuthContext.jsx";

const RESEND_COOLDOWN_SECONDS = 30;

export default function ConfirmEmail({ style }) {
  const { user, verifyEmailOtp, resendOtp } = useAuth();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const submit = async (e) => {
    e.preventDefault();
    if (busy || code.length !== 6 || !user?.email) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      // Confirming may be the last thing verification was waiting on, so the
      // session is refreshed and the screen moves on by itself.
      await verifyEmailOtp(user.email, code);
    } catch (err) {
      setError(err.message || "That code didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (cooldown > 0 || !user?.email) return;
    setError("");
    setMessage("");
    try {
      await resendOtp(user.email);
      setMessage("A new code is on its way. It's valid for 10 minutes.");
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err.message || "Could not send a new code.");
    }
  };

  return (
    <form onSubmit={submit} className="glass-card p-24 flex flex-col gap-12" style={style}>
      <div className="flex items-center gap-12">
        <Mail size={20} style={{ color: "var(--accent-primary)", flexShrink: 0 }} />
        <div>
          <h3 className="card-title">Confirm your email</h3>
          <p className="card-lead">
            We sent a 6-digit code to <strong>{user?.email}</strong>. You need to confirm it
            before you can be verified as a student.
          </p>
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="confirm-email-code">Verification code</label>
        <input
          id="confirm-email-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="123456"
        />
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{error}</span>
        </div>
      )}
      {message && (
        <div className="alert alert-info" role="status">
          <span>{message}</span>
        </div>
      )}

      <div className="flex gap-8 items-center" style={{ flexWrap: "wrap" }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || code.length !== 6}>
          {busy ? <span className="spinner" /> : "Confirm"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={resend} disabled={cooldown > 0}>
          {cooldown > 0 ? `Send a new code (${cooldown}s)` : "Send a new code"}
        </button>
      </div>
    </form>
  );
}
