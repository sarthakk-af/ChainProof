import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  createUser,
  deleteUser,
  getUserByEmail,
  getUserById,
  setPasswordHash,
  setEmailVerified,
  bumpTokenVersion,
  createPasswordReset,
  getPasswordReset,
  invalidateAllPasswordResetsForUser,
  setEmailOtp,
  getEmailOtp,
  incrementOtpAttempts,
  deleteEmailOtp,
} from "../db.js";
import {
  hashPassword,
  verifyPassword,
  signToken,
  generateResetToken,
  hashResetToken,
  validatePassword,
  PASSWORD_RULE_MESSAGE,
  generateOtp,
  hashOtp,
  OTP_TTL_MS,
  OTP_MAX_ATTEMPTS,
} from "../auth.js";
import { generateWallet } from "../wallets.js";
import { fundWallet, TreasuryExhaustedError, treasuryAddress } from "../treasury.js";
import { sendEmail, buildPasswordResetEmail, buildOtpEmail } from "../email.js";
import { userAuth } from "../middleware/userAuth.js";
import { tryComplete } from "../studentVerification.js";
import { logger } from "../logger.js";
import { EMAIL_RE } from "../limits.js";
import { config } from "../config.js";

export const authRouter = Router();

// Reachable with no prior authentication, and signup in particular spends
// real treasury gas money per call — generous for a real user, hostile to a
// script hammering the endpoint.
const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many signup attempts. Please try again later." },
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." },
});
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many reset requests. Please try again later." },
});
// Reset tokens are 256 bits of entropy, so brute-forcing one is infeasible —
// this is defense-in-depth/consistency with every other public endpoint here,
// not the actual line of defense.
const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again later." },
});

const checkEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many checks. Please slow down." },
});

// A 6-digit code is only ~1M possibilities — unlike the reset token, rate
// limiting the *guessing* endpoint is the actual line of defense here, paired
// with the per-OTP attempt counter in the DB (see OTP_MAX_ATTEMPTS below).
const verifyEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again later." },
});
const resendOtpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many codes requested. Please try again later." },
});

// Lets the signup form tell someone "that email's taken" as they type,
// instead of only after they've filled in a password and submitted. Doesn't
// leak anything beyond what /signup itself already reveals via its 409 —
// this is signup-only, unlike /forgot-password, which deliberately never
// confirms whether an email exists.
authRouter.get("/check-email", checkEmailLimiter, (req, res) => {
  const { email } = req.query;
  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "email is required" });
  }
  res.json({ available: !getUserByEmail(email) });
});

async function issueAndSendOtp(user) {
  const otp = generateOtp();
  setEmailOtp({ userId: user.id, otpHash: hashOtp(otp), expiresAt: Date.now() + OTP_TTL_MS });
  const { subject, html } = buildOtpEmail(otp);
  await sendEmail({ to: user.email, subject, html });
}

authRouter.post("/signup", signupLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }
  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }
  if (!validatePassword(password)) {
    return res.status(400).json({ error: PASSWORD_RULE_MESSAGE });
  }

  if (getUserByEmail(email)) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  let user = null;
  try {
    const passwordHash = await hashPassword(password);
    const { address, encryptedPrivateKey } = generateWallet();

    // The row first, gas second. The other way round, two signups racing on the
    // same email both passed the check above, both drew a gas drip from the
    // treasury, and the loser's insert failed — leaving a funded wallet with no
    // account pointing at it, once per race. The UNIQUE constraint decides the
    // race now, and a wallet is only funded once its account exists.
    user = createUser({
      email,
      passwordHash,
      walletAddress: address,
      encryptedPrivateKey,
    });

    try {
      await fundWallet(address);
    } catch (err) {
      // Nothing was spent, so leave nothing behind: the address must stay free
      // for a real signup later.
      deleteUser(user.id);
      user = null;
      throw err;
    }

    // No token yet — see /login and /verify-email below. An account only
    // becomes usable once this address has been shown to actually reach
    // someone, not just be a well-formed string.
    try {
      await issueAndSendOtp(user);
    } catch (err) {
      // The account still exists at this point (and its wallet is already
      // funded) — don't leave it permanently stuck with no way to ever get a
      // code. /resend-otp is the recovery path if this particular send failed.
      logger.error("signup_otp_send_failed", { email, message: err.message });
    }

    logger.info("user_signed_up", { email, address: user.wallet_address });
    // Signed in immediately. The code is already on its way, and confirming it
    // is something they do to finish verifying — not a turnstile before they
    // are allowed to see anything.
    const token = signToken({
      userId: user.id,
      address: user.wallet_address,
      tokenVersion: user.token_version,
    });
    res.status(201).json({
      message: "Account created. We've emailed you a code to confirm your address.",
      email: user.email,
      token,
      address: user.wallet_address,
      emailVerified: false,
    });
  } catch (err) {
    if (err instanceof TreasuryExhaustedError) {
      // Loud and specific: no signup can succeed until someone tops the
      // treasury up, and a generic "try again" would have people retrying a
      // request that cannot work while nobody knows why.
      logger.error("treasury_exhausted", {
        email,
        treasury: treasuryAddress,
        balanceEth: err.balanceEth,
        requiredEth: err.requiredEth,
      });
      return res.status(503).json({
        error:
          "Sign-ups are temporarily unavailable — the service wallet that funds new " +
          "accounts needs topping up. Please try again later.",
      });
    }
    // A concurrent signup for the same address or email won the UNIQUE
    // constraint. That is the check working, not a server fault.
    if (/UNIQUE constraint failed/i.test(err.message)) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }
    logger.error("signup_failed", { email, message: err.message, stack: err.stack });
    res.status(502).json({ error: "Could not create account. Please try again." });
  }
});

authRouter.post("/verify-email", verifyEmailLimiter, async (req, res) => {
  const { email, otp } = req.body || {};
  if (!email || !otp) {
    return res.status(400).json({ error: "email and otp are required" });
  }

  const user = getUserByEmail(email);
  if (!user) {
    return res.status(400).json({ error: "No account found for that email." });
  }
  if (user.email_verified) {
    return res.status(409).json({ error: "This account is already verified." });
  }

  const record = getEmailOtp(user.id);
  if (!record || record.expires_at < Date.now()) {
    return res.status(400).json({ error: "That code has expired. Request a new one." });
  }
  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    return res.status(429).json({ error: "Too many incorrect attempts. Request a new code." });
  }

  if (hashOtp(String(otp).trim()) !== record.otp_hash) {
    incrementOtpAttempts(user.id);
    return res.status(400).json({ error: "Incorrect code. Please try again." });
  }

  deleteEmailOtp(user.id);
  setEmailVerified(user.id);
  logger.info("email_verified", { email: user.email });

  // Confirming the email may be the second of the two conditions to land, so
  // this is one of the two places verification can complete. tryComplete is
  // safe to call when it isn't — "not yet" is an ordinary answer there.
  try {
    await tryComplete(user.id);
  } catch (err) {
    logger.error("verification_completion_failed", { email, message: err.message });
  }

  const token = signToken({ userId: user.id, address: user.wallet_address, tokenVersion: user.token_version });
  res.json({ token, address: user.wallet_address });
});

authRouter.post("/resend-otp", resendOtpLimiter, async (req, res) => {
  const { email } = req.body || {};
  if (!email) {
    return res.status(400).json({ error: "email is required" });
  }

  const user = getUserByEmail(email);
  if (!user) {
    return res.status(400).json({ error: "No account found for that email." });
  }
  if (user.email_verified) {
    return res.status(409).json({ error: "This account is already verified." });
  }

  try {
    await issueAndSendOtp(user);
    res.json({ message: "A new code has been sent." });
  } catch (err) {
    logger.error("resend_otp_failed", { email, message: err.message });
    res.status(502).json({ error: "Could not send the code. Please try again shortly." });
  }
});

authRouter.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const user = getUserByEmail(email);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    logger.warn("login_failed", { email });
    return res.status(401).json({ error: "Invalid email or password" });
  }

  // An unverified email no longer blocks sign-in. It used to, which put a wall
  // at the very first step and required a working inbox before you could even
  // look around. The address still has to be proved before anything counts —
  // it is one of the conditions for verification (see studentVerification.js) —
  // but proving it is no longer the price of getting through the door.
  logger.info("user_logged_in", { email, address: user.wallet_address, emailVerified: !!user.email_verified });

  const token = signToken({ userId: user.id, address: user.wallet_address, tokenVersion: user.token_version });
  res.json({
    token,
    address: user.wallet_address,
    // Not a gate any more, but the interface still needs to know so it can
    // prompt for it rather than silently leaving the account half-finished.
    emailVerified: !!user.email_verified,
  });
});

/** Invalidates every token issued to this account, not just the one in hand. */
authRouter.post("/logout", userAuth, (req, res) => {
  bumpTokenVersion(req.user.id);
  logger.info("user_logged_out", { address: req.user.address });
  res.json({ ok: true });
});

/**
 * Changes the password of the account you are signed in to.
 *
 * There was no way to do this at all: the only route to a new password was to
 * forget the old one and wait for an email, which needs a working mail service
 * and is absurd for someone who simply wants to change it.
 *
 * Changing it ends every other session, which is the point of changing it after
 * using a shared machine. This session continues, with the fresh token the
 * response carries.
 */
authRouter.post("/change-password", userAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Enter your current password and the new one." });
  }
  if (!validatePassword(newPassword)) {
    return res.status(400).json({ error: PASSWORD_RULE_MESSAGE });
  }

  const user = getUserById(req.user.id);
  if (!user || !(await verifyPassword(currentPassword, user.password_hash))) {
    logger.warn("change_password_wrong_current", { address: req.user.address });
    return res.status(403).json({ error: "That isn't your current password." });
  }
  if (await verifyPassword(newPassword, user.password_hash)) {
    return res.status(400).json({ error: "That is the password you already have." });
  }

  setPasswordHash(user.id, await hashPassword(newPassword));
  bumpTokenVersion(user.id);
  const fresh = getUserById(user.id);

  logger.info("password_changed", { address: req.user.address });
  res.json({
    message: "Password changed. Any other device signed in as you has been signed out.",
    token: signToken({
      userId: fresh.id,
      address: fresh.wallet_address,
      tokenVersion: fresh.token_version,
    }),
  });
});

/**
 * Ends every session for this account, including this one.
 *
 * The mechanism already existed — every token carries a version, and bumping it
 * invalidates the lot — but nothing exposed it, so "I signed in on a lab
 * computer and forgot to sign out" had no answer.
 */
authRouter.post("/sign-out-everywhere", userAuth, (req, res) => {
  bumpTokenVersion(req.user.id);
  logger.info("all_sessions_ended", { address: req.user.address });
  res.json({ message: "Signed out on every device, including this one." });
});

authRouter.post("/forgot-password", forgotPasswordLimiter, async (req, res) => {
  const { email } = req.body || {};
  if (!email) {
    return res.status(400).json({ error: "email is required" });
  }

  // Always the same response, whether or not the account exists — otherwise
  // this endpoint becomes a way to check which emails are registered.
  const genericResponse = { message: "If that email is registered, a reset link has been sent." };

  // Without a mail service there is no link and never will be, so saying "check
  // your inbox" is a lie that costs someone their afternoon. This is an
  // internal tool; naming the real obstacle is more use than hiding it.
  if (!config.brevoApiKey) {
    logger.warn("password_reset_without_email_service", { email });
    return res.status(503).json({
      error:
        "Password reset can't be sent: this server has no email service configured. " +
        "Ask your placement cell to reset it for you.",
    });
  }

  const user = getUserByEmail(email);
  if (!user) {
    logger.info("forgot_password_unknown_email", { email });
    return res.json(genericResponse);
  }

  try {
    const { token, tokenHash, expiresAt } = generateResetToken();
    createPasswordReset({ tokenHash, userId: user.id, expiresAt });

    const { subject, html } = buildPasswordResetEmail(token);
    await sendEmail({ to: email, subject, html });

    logger.info("password_reset_requested", { email });
  } catch (err) {
    // Still return the generic response — don't leak whether sending failed
    // due to a bad email vs. a configuration problem on our end.
    logger.error("password_reset_email_failed", { email, message: err.message });
  }

  res.json(genericResponse);
});

authRouter.post("/reset-password", resetPasswordLimiter, async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) {
    return res.status(400).json({ error: "token and newPassword are required" });
  }
  if (!validatePassword(newPassword)) {
    return res.status(400).json({ error: PASSWORD_RULE_MESSAGE });
  }

  const tokenHash = hashResetToken(token);
  const reset = getPasswordReset(tokenHash);
  if (!reset || reset.used || reset.expires_at < Date.now()) {
    return res.status(400).json({ error: "This reset link is invalid or has expired." });
  }

  const passwordHash = await hashPassword(newPassword);
  setPasswordHash(reset.user_id, passwordHash);
  // Invalidate every outstanding reset token for this user, not just the one
  // used — otherwise an earlier "forgot password" email (e.g. from before
  // this one) would still work for the rest of its hour-long life.
  invalidateAllPasswordResetsForUser(reset.user_id);
  // A reset should kick out anyone still using the old password/session.
  bumpTokenVersion(reset.user_id);
  // Completing a reset means this person opened a link delivered to that
  // inbox — which is at least as strong a proof of control as typing back a
  // code from the same inbox. Without this, someone who forgets their
  // password before ever verifying resets it successfully and is then still
  // refused at login, hunting for an OTP that has almost certainly expired.
  setEmailVerified(reset.user_id);

  const user = getUserById(reset.user_id);
  logger.info("password_reset_completed", { email: user.email });

  res.json({ message: "Password updated. Please log in again." });
});
