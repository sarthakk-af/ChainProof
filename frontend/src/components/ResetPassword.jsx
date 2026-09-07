/**
 * ResetPassword.jsx — Landing page for the link emailed by "Forgot password?"
 * Reached at /reset-password?token=... (plain-pathname routing, same as /admin and /public).
 */

import React, { useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";

export default function ResetPassword() {
  const { resetPassword } = useAuth();
  const token = new URLSearchParams(window.location.search).get("token");

  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
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
        <div style={{ fontSize: "3rem", marginBottom: 16 }}>❌</div>
        <h2 style={{ marginBottom: 12 }}>Invalid Link</h2>
        <p style={{ marginBottom: 24 }}>This page needs a reset token from the email link.</p>
        <a href="/" className="btn btn-primary">← Back to Sign In</a>
      </div>
    );
  }

  if (done) {
    return (
      <div className="page-container animate-fade-in-up text-center" style={{ maxWidth: 480, marginTop: 100 }}>
        <div style={{ fontSize: "3rem", marginBottom: 16 }}>✅</div>
        <h2 style={{ marginBottom: 12 }}>Password Updated</h2>
        <p style={{ marginBottom: 24 }}>You can now sign in with your new password.</p>
        <a href="/" className="btn btn-primary">🔐 Go to Sign In</a>
      </div>
    );
  }

  return (
    <div className="page-container animate-fade-in-up" style={{ maxWidth: 480, marginTop: 100 }}>
      <div className="section-eyebrow">Password Reset</div>
      <h2 style={{ marginBottom: 20 }}>Choose a new password</h2>
      <form className="glass-card p-32 flex flex-col gap-16" onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="reset-password">New Password</label>
          <input
            id="reset-password"
            type="password"
            placeholder="At least 6 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={6}
            required
          />
        </div>

        {error && (
          <div className="alert alert-danger">
            <span>❌</span>
            <span>{error}</span>
          </div>
        )}

        <button id="reset-submit-btn" type="submit" className="btn btn-primary btn-lg" disabled={loading}>
          {loading ? (
            <><div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Updating…</>
          ) : (
            "✅ Update Password"
          )}
        </button>
      </form>
    </div>
  );
}
