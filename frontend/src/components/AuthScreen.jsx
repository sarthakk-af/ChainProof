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
import { Eye, EyeOff, LogIn, UserPlus, Mail, Check, AlertCircle, Info, ArrowLeft, ShieldCheck, RotateCw } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../utils/api.js";
import { Link } from "../utils/navigation.jsx";

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
  const { signup, login, verifyEmailOtp, resendOtp, forgotPassword } = useAuth();

  const [mode, setMode] = useState(initialMode); // "login" | "signup" | "forgot" | "verify"
  const [otp, setOtp] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendMessage, setResendMessage] = useState("");
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

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const switchMode = (next) => {
    setMode(next);
    setError("");
    setInfoMessage("");
    setPasswordTouched(false);
    setConfirmTouched(false);
    setConfirmPassword("");
    setOtp("");
    setResendMessage("");
    setResendCooldown(0);
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
        await signup(email.trim(), password);
        // The account exists now but has no session — it only becomes
        // usable once the emailed code comes back through verify-email.
        setMode("verify");
      } else if (mode === "forgot") {
        const { message } = await forgotPassword(email.trim());
        setInfoMessage(message);
      } else if (mode === "verify") {
        await verifyEmailOtp(email.trim(), otp.trim());
        // Success flips AuthContext's status to "authenticated" — App.jsx
        // takes it from here, same as a normal login.
      } else {
        await login(email.trim(), password);
      }
    } catch (err) {
      if (err.requiresVerification) {
        setMode("verify");
        setEmail(err.email || email);
        setError("");
        setInfoMessage("Enter the code we emailed you, or send a new one below.");
      } else {
        setError(err.message || "Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setError("");
    setResendMessage("");
    try {
      await resendOtp(email.trim());
      setResendMessage("A new code is on its way.");
      setResendCooldown(30);
    } catch (err) {
      setError(err.message || "Could not send a new code.");
    }
  };

  const submitDisabled =
    loading ||
    (mode === "signup" && (!passwordMeetsRule(password) || confirmPassword !== password || !EMAIL_RE.test(email))) ||
    (mode === "verify" && otp.trim().length !== 6);

  return (
    <div className="page-container auth-page">
      <form className="glass-card p-32 animate-pulse-glow flex flex-col gap-16" onSubmit={handleSubmit} noValidate>
        {mode === "signup" && (
          <div className="flex items-center gap-8" style={{ marginBottom: -4 }}>
            <span className="badge badge-student">Step 1 of 2</span>
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Account · next comes your role</span>
          </div>
        )}

        {/* The heading gets the full width; the link to the other page sits
            under the form, where people look for it once they realise they are
            on the wrong one. */}
        <h2 style={{ margin: "0 0 4px", fontSize: "1.6rem" }}>
          {mode === "signup"
            ? "Create your account"
            : mode === "forgot"
            ? "Reset your password"
            : mode === "verify"
            ? "Verify your email"
            : "Sign in"}
        </h2>

        {mode === "verify" && (
          <p style={{ fontSize: "0.88rem", margin: "0 0 4px" }}>
            We sent a 6-digit code to <strong>{email}</strong>. Enter it below to activate your account.
          </p>
        )}

        {mode !== "verify" && (
        <div className="form-group">
          <label htmlFor="auth-email">Email</label>
          <input
            id="auth-email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(""); }}
            onBlur={() => setEmailTouched(true)}
            autoComplete="email"
            required
            aria-invalid={emailServerError || (emailTouched && !emailFormatValid) ? "true" : undefined}
            aria-describedby="auth-email-msg"
            style={
              emailServerError || (emailTouched && !emailFormatValid)
                ? { borderColor: "var(--accent-danger)" }
                : mode === "signup" && emailAvailability === "available"
                ? { borderColor: "var(--accent-success)" }
                : undefined
            }
          />
          <span id="auth-email-msg" aria-live="polite" style={{ fontSize: "0.78rem" }}>
            {emailServerError ? (
              <span style={{ color: "var(--accent-danger)" }}>{error}</span>
            ) : emailTouched && !emailFormatValid ? (
              <span style={{ color: "var(--accent-danger)" }}>Enter a valid email address.</span>
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
        )}

        {mode === "verify" && (
          <div className="form-group">
            <label htmlFor="auth-otp">Verification code</label>
            <input
              id="auth-otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              style={{ fontFamily: "var(--font-mono)", fontSize: "1.3rem", letterSpacing: "0.4em", textAlign: "center" }}
              required
            />
          </div>
        )}

        {mode !== "forgot" && mode !== "verify" && (
          <div className="form-group">
            <label htmlFor="auth-password">Password</label>
            {mode === "signup" && (
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 6px" }}>
                At least {PASSWORD_MIN_LENGTH} characters, including a number.
              </p>
            )}
            <div style={{ position: "relative" }}>
              <input
                id="auth-password"
                type={showPassword ? "text" : "password"}
                placeholder={mode === "signup" ? `At least ${PASSWORD_MIN_LENGTH} characters` : "••••••••"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => setPasswordTouched(true)}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                minLength={mode === "signup" ? PASSWORD_MIN_LENGTH : undefined}
                required
                aria-invalid={mode === "signup" && passwordTouched && !passwordValid ? "true" : undefined}
                aria-describedby="auth-password-msg"
                style={{
                  paddingRight: 40,
                  borderColor:
                    mode === "signup" && passwordTouched && !passwordValid ? "var(--accent-danger)" : undefined,
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
                  style={{ fontSize: "0.72rem", color: `var(--accent-${strength.cls})` }}
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
            <label htmlFor="auth-confirm-password">Confirm Password</label>
            <input
              id="auth-confirm-password"
              type={showPassword ? "text" : "password"}
              placeholder="Re-enter your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onBlur={() => setConfirmTouched(true)}
              autoComplete="new-password"
              required
              aria-invalid={confirmTouched && !confirmValid ? "true" : undefined}
              aria-describedby="auth-confirm-msg"
              style={{
                borderColor: confirmTouched && !confirmValid ? "var(--accent-danger)" : undefined,
              }}
            />
            <span id="auth-confirm-msg" aria-live="polite" style={{ fontSize: "0.78rem" }}>
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

        {infoMessage && (
          <div className="alert alert-info" role="status">
            <Info size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{infoMessage}</span>
          </div>
        )}

        {resendMessage && mode === "verify" && (
          <div className="alert alert-info" role="status">
            <Info size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{resendMessage}</span>
          </div>
        )}

        <button id="auth-submit-btn" type="submit" className="btn btn-primary btn-lg" disabled={submitDisabled}>
          {loading ? (
            <>
              <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
              {mode === "signup"
                ? "Creating account…"
                : mode === "forgot"
                ? "Sending…"
                : mode === "verify"
                ? "Verifying…"
                : "Signing in…"}
            </>
          ) : mode === "signup" ? (
            <><UserPlus size={16} /> Create account</>
          ) : mode === "forgot" ? (
            <><Mail size={16} /> Send reset link</>
          ) : mode === "verify" ? (
            <><ShieldCheck size={16} /> Verify and continue</>
          ) : (
            <><LogIn size={16} /> Sign in</>
          )}
        </button>

        {mode === "verify" && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={handleResend}
            disabled={resendCooldown > 0}
            style={{ alignSelf: "center" }}
          >
            <RotateCw size={14} /> {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : "Resend code"}
          </button>
        )}

        {(mode === "forgot" || mode === "verify") && (
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
