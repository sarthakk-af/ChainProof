import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  createUser,
  getUserByEmail,
  getUserById,
  setPasswordHash,
  bumpTokenVersion,
  createPasswordReset,
  getPasswordReset,
  invalidateAllPasswordResetsForUser,
} from "../db.js";
import {
  hashPassword,
  verifyPassword,
  signToken,
  generateResetToken,
  hashResetToken,
  validatePassword,
  PASSWORD_RULE_MESSAGE,
} from "../auth.js";
import { generateWallet } from "../wallets.js";
import { fundWallet } from "../treasury.js";
import { sendEmail, buildPasswordResetEmail } from "../email.js";
import { userAuth } from "../middleware/userAuth.js";
import { logger } from "../logger.js";

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

authRouter.post("/signup", signupLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }
  if (!validatePassword(password)) {
    return res.status(400).json({ error: PASSWORD_RULE_MESSAGE });
  }

  if (getUserByEmail(email)) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  try {
    const passwordHash = await hashPassword(password);
    const { address, encryptedPrivateKey } = generateWallet();

    // Fund before persisting the user — an unfunded custodial wallet can't
    // transact at all, so there's no point creating an account around one.
    await fundWallet(address);

    const user = createUser({
      email,
      passwordHash,
      walletAddress: address,
      encryptedPrivateKey,
    });

    logger.info("user_signed_up", { email, address: user.wallet_address });

    const token = signToken({ userId: user.id, address: user.wallet_address, tokenVersion: user.token_version });
    res.status(201).json({ token, address: user.wallet_address });
  } catch (err) {
    logger.error("signup_failed", { email, message: err.message, stack: err.stack });
    res.status(502).json({ error: "Could not create account. Please try again." });
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

  logger.info("user_logged_in", { email, address: user.wallet_address });

  const token = signToken({ userId: user.id, address: user.wallet_address, tokenVersion: user.token_version });
  res.json({ token, address: user.wallet_address });
});

/** Invalidates every token issued to this account, not just the one in hand. */
authRouter.post("/logout", userAuth, (req, res) => {
  bumpTokenVersion(req.user.id);
  logger.info("user_logged_out", { address: req.user.address });
  res.json({ ok: true });
});

authRouter.post("/forgot-password", forgotPasswordLimiter, async (req, res) => {
  const { email } = req.body || {};
  if (!email) {
    return res.status(400).json({ error: "email is required" });
  }

  // Always the same response, whether or not the account exists — otherwise
  // this endpoint becomes a way to check which emails are registered.
  const genericResponse = { message: "If that email is registered, a reset link has been sent." };

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

  const user = getUserById(reset.user_id);
  logger.info("password_reset_completed", { email: user.email });

  res.json({ message: "Password updated. Please log in again." });
});
