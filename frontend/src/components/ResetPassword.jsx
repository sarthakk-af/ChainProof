/**
 * ResetPassword.jsx — Landing page for the link emailed by "Forgot password?"
 * Reached at /reset-password?token=... (plain-pathname routing, same as /admin and /public).
 */

import React, { useState } from "react";
import { Eye, EyeOff, AlertCircle, ArrowLeft, CheckCircle2, XCircle, KeyRound } from "lucide-react";
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
  const [showPassword, setShowPassword] = useState(false);
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
      <div className="page-container animate-fade-in-up text-center" style={{ maxWidth: 480, marginTop: 100 }}>
        <XCircle size={40} style={{ color: "var(--accent-danger)", marginBottom: 16 }} />
        <h2 style={{ marginBottom: 12 }}>Invalid Link</h2>
        <p style={{ marginBottom: 24 }}>This page needs a reset token from the email link.</p>
        <a href="/" className="btn btn-primary"><ArrowLeft size={16} /> Back to Sign In</a>
      </div>
    );
  }

  if (done) {
    return (
      <div className="page-container animate-fade-in-up text-center" style={{ maxWidth: 480, marginTop: 100 }}>
        <CheckCircle2 size={40} style={{ color: "var(--accent-success)", marginBottom: 16 }} />
        <h2 style={{ marginBottom: 12 }}>Password Updated</h2>
        <p style={{ marginBottom: 24 }}>You can now sign in with your new password.</p>
        <a href="/" className="btn btn-primary">Go to Sign In</a>
      </div>
    );
  }

  return (
    <div className="page-container animate-fade-in-up" style={{ maxWidth: 480, marginTop: 100 }}>
      <div className="section-eyebrow">Password Reset</div>
      <h2 style={{ marginBottom: 20 }}>Choose a new password</h2>
      <form className="glass-card p-32 flex flex-col gap-16" onSubmit={handleSubmit} noValidate>
        <div className="form-group">
          <label htmlFor="reset-password">New Password</label>
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 6px" }}>
            At least {PASSWORD_MIN_LENGTH} characters, including a number.
          </p>
          <div style={{ position: "relative" }}>
            <input
              id="reset-password"
              type={showPassword ? "text" : "password"}
              placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => setPasswordTouched(true)}
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              required
              aria-invalid={passwordTouched && !passwordValid ? "true" : undefined}
              aria-describedby="reset-password-msg"
              style={{
                paddingRight: 40,
                borderColor: passwordTouched && !passwordValid ? "var(--accent-danger)" : undefined,
              }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              className="btn btn-ghost btn-sm"
              style={{
                position: "absolute",
                right: 6,
                top: "50%",
                transform: "translateY(-50%)",
                padding: 6,
              }}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
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
            <><div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Updating…</>
          ) : (
            <><KeyRound size={16} /> Update Password</>
          )}
        </button>
      </form>
    </div>
  );
}
