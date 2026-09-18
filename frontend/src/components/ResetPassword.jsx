/**
 * ResetPassword.jsx — Landing page for the link emailed by "Forgot password?"
 * Reached at /reset-password?token=... (plain-pathname routing, same as /admin and /public).
 */

import React, { useState } from "react";
import { AlertCircle, ArrowLeft, CheckCircle2, XCircle, KeyRound } from "lucide-react";
import { Link } from "../utils/navigation.jsx";
import PasswordInput from "./shared/PasswordInput.jsx";
import { useAuth } from "../context/AuthContext.jsx";

// Mirrors backend/src/auth.js's validatePassword — see AuthScreen.jsx for the
// same rule/strength logic used at signup.
const PASSWORD_MIN_LENGTH = 8;
function passwordMeetsRule(pw) {
  return pw.length >= PASSWORD_MIN_LENGTH && /\d/.test(pw);
}

export default function ResetPassword() {
  const { resetPassword } = useAuth();
  const token = new URLSearchParams(window.location.search).get("token");

  const [password, setPassword] = useState("");
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const passwordValid = passwordMeetsRule(password);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    if (!passwordValid) {
      setPasswordTouched(true);
      return;
    }
    setLoading(true);
    setError("");
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err.message || "Could not reset password.");
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="page-container page-status animate-fade-in-up">
        <XCircle size={40} style={{ color: "var(--accent-danger)", marginBottom: 16 }} />
        <h2 style={{ marginBottom: 12 }}>Invalid link</h2>
        <p style={{ marginBottom: 24 }}>This page needs a reset token from the email link.</p>
        <Link to="/login" className="btn btn-primary"><ArrowLeft size={16} /> Back to sign in</Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="page-container page-status animate-fade-in-up">
        <CheckCircle2 size={40} style={{ color: "var(--accent-success)", marginBottom: 16 }} />
        <h2 style={{ marginBottom: 12 }}>Password updated</h2>
        <p style={{ marginBottom: 24 }}>You can now sign in with your new password.</p>
        <Link to="/login" className="btn btn-primary">Go to sign in</Link>
      </div>
    );
  }

  return (
    <div className="page-container auth-page animate-fade-in-up">
      <form className="glass-card p-32 flex flex-col gap-16" onSubmit={handleSubmit} noValidate>
        <h2 style={{ margin: "0 0 4px", fontSize: "1.6rem" }}>Choose a new password</h2>
        <div className="form-group">
          <label htmlFor="reset-password">New password</label>
          <p className="form-hint" style={{ margin: "0 0 6px" }}>
            At least {PASSWORD_MIN_LENGTH} characters, including a number.
          </p>
          <PasswordInput
            id="reset-password"
            placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => setPasswordTouched(true)}
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            required
            aria-invalid={passwordTouched && !passwordValid ? "true" : undefined}
            aria-describedby="reset-password-msg"
          />
          {passwordTouched && !passwordValid && (
            <span id="reset-password-msg" aria-live="polite" style={{ fontSize: "0.78rem", color: "var(--accent-danger)" }}>
              Needs {PASSWORD_MIN_LENGTH}+ characters and a number.
            </span>
          )}
        </div>

        {error && (
          <div className="alert alert-danger" role="alert">
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{error}</span>
          </div>
        )}

        <button id="reset-submit-btn" type="submit" className="btn btn-primary btn-lg" disabled={loading || !passwordValid}>
          {loading ? (
            <span className="spinner" />
          ) : (
            <><KeyRound size={16} /> Update password</>
          )}
        </button>
      </form>
    </div>
  );
}
