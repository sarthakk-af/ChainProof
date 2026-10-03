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

import React, { useState, useEffect, useRef } from "react";
import { LogIn, UserPlus, Mail, Check, AlertCircle, Info, ArrowLeft } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../utils/api.js";
import { toast } from "../utils/toast.js";
import { Link } from "../utils/navigation.jsx";
import { noEmojis } from "../utils/validation.js";
import PasswordInput from "./shared/PasswordInput.jsx";

// Mirrors backend/src/auth.js's validatePassword — client-side is UX only,
// the server re-checks the exact same rule regardless of what this says.
const PASSWORD_MIN_LENGTH = 8;
function passwordMeetsRule(pw) {
  return pw.length >= PASSWORD_MIN_LENGTH && /\d/.test(pw);
}
function passwordStrength(pw) {
  if (!pw) return { label: "", pct: 0, cls: "" };
  let score = 0;
  if (pw.length >= PASSWORD_MIN_LENGTH) score++;
  if (pw.length >= 12) score++;
  if (/\d/.test(pw)) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { label: "Weak", pct: 25, cls: "danger" };
  if (score <= 3) return { label: "Okay", pct: 60, cls: "warning" };
  return { label: "Strong", pct: 100, cls: "success" };
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AuthScreen({ initialMode = "login" }) {
  const { signup, login, forgotPassword } = useAuth();

  // The emailed sign-up code is entered after signing in, on the next screen
  // (shared/ConfirmEmail.jsx), so this form has no step for it.
  const [mode, setMode] = useState(initialMode); // "login" | "signup" | "forgot"
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [emailAvailability, setEmailAvailability] = useState(null); // null | "checking" | "taken" | "available"
  const [password, setPassword] = useState("");
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  // Only true for the one error we can confidently attribute to a specific
  // field (email already registered) — ambiguous errors like "invalid email
  // or password" stay as a general banner rather than falsely blaming one field.
  const emailServerError = Boolean(error) && mode === "signup" && error.toLowerCase().includes("email");

  const emailFormatValid = email === "" || EMAIL_RE.test(email);
  const passwordValid = mode !== "signup" || passwordMeetsRule(password);
  const confirmValid = mode !== "signup" || confirmPassword === "" || confirmPassword === password;
  const strength = passwordStrength(password);

  // Debounced "is this email already registered" check — signup only.
  // Doesn't fire until the address at least looks like an email, so it's not
  // pinging the backend on every single keystroke of a half-typed address.
  const checkTimer = useRef(null);
  useEffect(() => {
    if (mode !== "signup" || !EMAIL_RE.test(email)) {
      setEmailAvailability(null);
      return;
    }
    setEmailAvailability("checking");
    clearTimeout(checkTimer.current);
    checkTimer.current = setTimeout(async () => {
      try {
        const { available } = await api.get(`/auth/check-email?email=${encodeURIComponent(email)}`);
        setEmailAvailability(available ? "available" : "taken");
      } catch {
        setEmailAvailability(null); // couldn't check — say nothing rather than guess
      }
    }, 500);
    return () => clearTimeout(checkTimer.current);
  }, [email, mode]);

  // Coming back to a field clears its complaint; leaving it judges it again.
  // Without this the message sat there while the person was mid-fix, which
  // reads as nagging rather than helping.
  const switchMode = (next) => {
    setMode(next);
    setError("");
    setInfoMessage("");
    setPasswordTouched(false);
    setConfirmTouched(false);
    setConfirmPassword("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Checks its own in-flight state directly rather than relying only on
    // the submit button's disabled attribute — see the same guard pattern
    // used for every on-chain write elsewhere in this app.
    if (loading) return;

    if (mode === "signup" && (!passwordMeetsRule(password) || confirmPassword !== password)) {
      setPasswordTouched(true);
      setConfirmTouched(true);
      return;
    }

    setLoading(true);
    setError("");
    setInfoMessage("");
    try {
      if (mode === "signup") {
        // Signing up signs straight in, and App.jsx moves a signed-in account
        // off this page — so the emailed code is taken on the next screen (see
        // shared/ConfirmEmail.jsx), not here.
        await signup(email.trim(), password);
        toast.success("Account created. We've emailed you a 6-digit code; you'll enter it on the next screen.");
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

  const submitDisabled =
    loading ||
    (mode === "signup" && (!passwordMeetsRule(password) || confirmPassword !== password || !EMAIL_RE.test(email)));

  return (
    <div className="page-container auth-page">
      <form className="glass-card p-32 animate-pulse-glow flex flex-col gap-16" onSubmit={handleSubmit} noValidate>
        {mode === "signup" && (
          <div className="flex items-center gap-8" style={{ marginBottom: -4 }}>
            <span className="badge badge-student">Step 1 of 2</span>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Account · next comes your role</span>
          </div>
        )}

        {/* The heading gets the full width; the link to the other page sits
            under the form, where people look for it once they realise they are
            on the wrong one. */}
        <h2 style={{ margin: "0 0 4px", fontSize: "var(--text-xl)" }}>
          {mode === "signup"
            ? "Create your account"
            : mode === "forgot"
            ? "Reset your password"
            : "Sign in"}
        </h2>

        <div className="form-group">
          <label htmlFor="auth-email">Email</label>
          <input
            id="auth-email"
            type="email"
            placeholder="you@example.com"
            maxLength={255}
            value={email}
            onChange={(e) => { setEmail(noEmojis(e.target.value).replace(/\s/g, "")); setError(""); }}
            onFocus={() => setEmailTouched(false)}
            onBlur={() => setEmailTouched(true)}
            autoComplete="email"
            required
            aria-invalid={emailServerError || (emailTouched && !emailFormatValid) ? "true" : undefined}
            aria-describedby="auth-email-msg"
            style={
              mode === "signup" && emailAvailability === "available" && !emailServerError && emailFormatValid
                ? { borderColor: "var(--accent-success)" }
                : undefined
            }
          />
          {/* The single most useful sentence on this form: a student who signs
              up with a personal address is not matched to the roster and waits
              in a queue instead, with nothing having told them why. */}
          {mode === "signup" && (
            <p className="form-hint">
              Students: use the college email address your placement cell has for you — that is
              how your roll number is matched automatically.
            </p>
          )}
          <span id="auth-email-msg" aria-live="polite" style={{ fontSize: "var(--text-xs)" }}>
            {emailServerError ? (
              <span style={{ color: "var(--accent-danger)" }}>{error}</span>
            ) : emailTouched && !emailFormatValid ? (
              <span className="field-message">
                <AlertCircle size={13} aria-hidden="true" /> Enter a valid email address.
              </span>
            ) : mode === "signup" && emailAvailability === "checking" ? (
              <span style={{ color: "var(--text-muted)" }}>Checking availability…</span>
            ) : mode === "signup" && emailAvailability === "taken" ? (
              <span style={{ color: "var(--accent-danger)" }}>An account with this email already exists.</span>
            ) : mode === "signup" && emailAvailability === "available" ? (
              <span style={{ color: "var(--accent-success)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Check size={13} /> Available
              </span>
            ) : null}
          </span>
        </div>

        {mode !== "forgot" && (
          <div className="form-group">
            <label htmlFor="auth-password">Password</label>
            {mode === "signup" && (
              <p className="form-hint" style={{ margin: "0 0 6px" }}>
                At least {PASSWORD_MIN_LENGTH} characters, including a number.
              </p>
            )}
            <PasswordInput
              id="auth-password"
              shown={showPassword}
              onToggle={() => setShowPassword((v) => !v)}
              placeholder={mode === "signup" ? `At least ${PASSWORD_MIN_LENGTH} characters` : "••••••••"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setPasswordTouched(false)}
              onBlur={() => setPasswordTouched(true)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              minLength={mode === "signup" ? PASSWORD_MIN_LENGTH : undefined}
              maxLength={128}
              required
              aria-invalid={mode === "signup" && passwordTouched && !passwordValid ? "true" : undefined}
              aria-describedby="auth-password-msg"
            />
            {mode === "signup" && password && (
              <div style={{ marginTop: 6 }}>
                <div style={{ height: 4, borderRadius: 2, background: "var(--border-card)", overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${strength.pct}%`,
                      background: `var(--accent-${strength.cls})`,
                      transition: "var(--transition)",
                    }}
                  />
                </div>
                <span
                  id="auth-password-msg"
                  aria-live="polite"
                  style={{ fontSize: "var(--text-xs)", color: `var(--accent-${strength.cls})` }}
                >
                  {strength.label}
                  {passwordTouched && !passwordValid ? ` — needs ${PASSWORD_MIN_LENGTH}+ characters and a number` : ""}
                </span>
              </div>
            )}
          </div>
        )}

        {mode === "signup" && (
          <div className="form-group">
            <label htmlFor="auth-confirm-password">Confirm password</label>
            <PasswordInput
              id="auth-confirm-password"
              shown={showPassword}
              withToggle={false}
              placeholder="Re-enter your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onFocus={() => setConfirmTouched(false)}
              onBlur={() => setConfirmTouched(true)}
              autoComplete="new-password"
              maxLength={128}
              required
              aria-invalid={confirmTouched && !confirmValid ? "true" : undefined}
              aria-describedby="auth-confirm-msg"
            />
            <span id="auth-confirm-msg" aria-live="polite" style={{ fontSize: "var(--text-xs)" }}>
              {confirmTouched && confirmPassword && confirmPassword === password ? (
                <span style={{ color: "var(--accent-success)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Check size={13} /> Passwords match
                </span>
              ) : confirmTouched && !confirmValid ? (
                <span style={{ color: "var(--accent-danger)" }}>Passwords don't match.</span>
              ) : null}
            </span>
          </div>
        )}

        {mode === "login" && (
          <button type="button" className="link-button" onClick={() => switchMode("forgot")}>
            Forgot password?
          </button>
        )}

        {error && !emailServerError && (
          <div className="alert alert-danger" role="alert">
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{error}</span>
          </div>
        )}

        {/* Said here because somebody coming back to the link tomorrow needs to
            know why it no longer works. */}
        {mode === "forgot" && !infoMessage && (
          <p className="form-hint">The link we send lasts one hour.</p>
        )}
        {infoMessage && (
          <div className="alert alert-info" role="status">
            <Info size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{infoMessage}</span>
          </div>
        )}

        <button id="auth-submit-btn" type="submit" className="btn btn-primary btn-lg" disabled={submitDisabled}>
          {loading ? (
            <span className="spinner" />
          ) : mode === "signup" ? (
            <><UserPlus size={16} /> Create account</>
          ) : mode === "forgot" ? (
            <><Mail size={16} /> Send reset link</>
          ) : (
            <><LogIn size={16} /> Sign in</>
          )}
        </button>

        {mode === "forgot" && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => switchMode("login")}>
            <ArrowLeft size={14} /> Back to sign in
          </button>
        )}
        {mode === "signup" && (
          <p className="auth-switch">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        )}
        {mode === "login" && (
          <p className="auth-switch">
            New here? <Link to="/signup">Create an account</Link>
          </p>
        )}
      </form>
    </div>
  );
}
