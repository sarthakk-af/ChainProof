/**
 * AuthScreen.jsx — The actual sign-in/sign-up form.
 *
 * The "what is ChainProof" explanation lives in ProjectExplainer.jsx now —
 * this component is just the account form itself, shown by LandingPage.jsx
 * once someone clicks "Create an account" (not embedded further down the
 * same page anymore — one entry point, not two). Kept as its own file/
 * component since Registration.jsx (the role + profile step right after
 * signup) is a separate screen — this step indicator is step 1 of that same
 * two-step onboarding.
 */

import React, { useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";

export default function AuthScreen({ initialMode = "login" }) {
  const { signup, login, forgotPassword } = useAuth();

  const [mode, setMode] = useState(initialMode); // "login" | "signup" | "forgot"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  // Only true for the one error we can confidently attribute to a specific
  // field (email already registered) — ambiguous errors like "invalid email
  // or password" stay as a general banner rather than falsely blaming one field.
  const emailError = Boolean(error) && mode === "signup" && error.toLowerCase().includes("email");

  const switchMode = (next) => {
    setMode(next);
    setError("");
    setInfoMessage("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setInfoMessage("");
    try {
      if (mode === "signup") {
        await signup(email.trim(), password);
      } else if (mode === "forgot") {
        const { message } = await forgotPassword(email.trim());
        setInfoMessage(message);
      } else {
        await login(email.trim(), password);
      }
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="get-started" className="page-container" style={{ maxWidth: 480, paddingTop: 0 }}>
      <form className="glass-card p-32 animate-pulse-glow flex flex-col gap-16" onSubmit={handleSubmit}>
        {mode === "signup" && (
          <div className="flex items-center gap-8" style={{ marginBottom: -4 }}>
            <span className="badge badge-student">Step 1 of 2</span>
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Account · next comes your role</span>
          </div>
        )}

        <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
          <h3 style={{ margin: 0 }}>
            {mode === "signup" ? "Create your account" : mode === "forgot" ? "Reset your password" : "Sign in"}
          </h3>
          {mode !== "forgot" && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => switchMode(mode === "signup" ? "login" : "signup")}
            >
              {mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
            </button>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="auth-email">Email</label>
          <input
            id="auth-email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(""); }}
            autoComplete="email"
            required
            style={emailError ? { borderColor: "var(--accent-danger)" } : undefined}
            aria-invalid={emailError ? "true" : undefined}
          />
          {emailError && (
            <span style={{ fontSize: "0.78rem", color: "var(--accent-danger)" }}>{error}</span>
          )}
        </div>

        {mode !== "forgot" && (
          <div className="form-group">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              placeholder={mode === "signup" ? "At least 6 characters" : "••••••••"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              minLength={6}
              required
            />
          </div>
        )}

        {mode === "login" && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ alignSelf: "flex-start", padding: 0 }}
            onClick={() => switchMode("forgot")}
          >
            Forgot password?
          </button>
        )}

        {error && !emailError && (
          <div className="alert alert-danger">
            <span>❌</span>
            <span>{error}</span>
          </div>
        )}

        {infoMessage && (
          <div className="alert alert-info">
            <span>📧</span>
            <span>{infoMessage}</span>
          </div>
        )}

        <button id="auth-submit-btn" type="submit" className="btn btn-primary btn-lg" disabled={loading}>
          {loading ? (
            <>
              <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
              {mode === "signup" ? "Creating account…" : mode === "forgot" ? "Sending…" : "Signing in…"}
            </>
          ) : mode === "signup" ? (
            "✅ Create Account"
          ) : mode === "forgot" ? (
            "📧 Send Reset Link"
          ) : (
            "🔐 Sign In"
          )}
        </button>

        {mode === "forgot" && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => switchMode("login")}>
            ← Back to sign in
          </button>
        )}
      </form>

      <div className="text-center" style={{ marginTop: 24 }}>
        <a href="/public" style={{ fontSize: "0.85rem" }}>
          📊 View Public Placement Dashboard — no sign-in required →
        </a>
      </div>
    </div>
  );
}
