/**
 * AuthScreen.jsx — Landing / sign-in screen
 * Shown when there is no active session. Normal email + password, no wallet.
 */

import React, { useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";

export default function AuthScreen() {
  const { signup, login, forgotPassword } = useAuth();

  const [mode, setMode] = useState("login"); // "login" | "signup" | "forgot"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [infoMessage, setInfoMessage] = useState("");

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
    <div className="page-container animate-fade-in-up" style={{ maxWidth: 640, marginTop: 60 }}>
      {/* Hero */}
      <div className="text-center" style={{ marginBottom: 48 }}>
        <div style={{ fontSize: "4rem", marginBottom: 16, filter: "drop-shadow(0 0 24px rgba(108,99,255,0.6))" }}>
          ⛓️
        </div>
        <div className="section-eyebrow">Decentralised · Transparent · Tamper-Proof</div>
        <h1 style={{ marginBottom: 16 }}>
          Welcome to{" "}
          <span
            style={{
              background: "linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            ChainProof
          </span>
        </h1>
        <p style={{ fontSize: "1.05rem", maxWidth: 480, margin: "0 auto" }}>
          A neutral ledger for verifiable student placement credentials — every
          record lives on the blockchain. Just sign in like any other app; no
          wallet or crypto knowledge needed.
        </p>
      </div>

      {/* Features */}
      <div className="grid-3 stagger-children" style={{ marginBottom: 40 }}>
        {[
          { icon: "🎓", title: "Students", desc: "Own your placement proof on-chain. No admin can alter it." },
          { icon: "🏛️", title: "Colleges", desc: "Issue tamper-proof credentials. View unalterable placement stats." },
          { icon: "🏢", title: "Companies", desc: "Manage recruitment pipelines with transparent, auditable records." },
        ].map((f) => (
          <div key={f.title} className="glass-card p-24 text-center animate-fade-in-up">
            <div style={{ fontSize: "2rem", marginBottom: 10 }}>{f.icon}</div>
            <h3 style={{ marginBottom: 6, fontSize: "1rem" }}>{f.title}</h3>
            <p style={{ fontSize: "0.85rem" }}>{f.desc}</p>
          </div>
        ))}
      </div>

      {/* Auth form */}
      <form className="glass-card p-32 animate-pulse-glow flex flex-col gap-16" onSubmit={handleSubmit}>
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
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
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

        {error && (
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
