import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "./config.js";

const SALT_ROUNDS = 10;
const TOKEN_TTL = "7d";
const ADMIN_TOKEN_TTL = "12h";
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
export const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const OTP_MAX_ATTEMPTS = 5;

// Single source of truth for the password rule — signup and reset-password
// both call this, and the frontend's upfront rule text/strength indicator
// describes this same rule (kept in sync by hand since it's a separate
// runtime, not a shared package).
export const PASSWORD_RULE_MESSAGE = "Password must be at least 8 characters and include a number.";

export function validatePassword(password) {
  return typeof password === "string" && password.length >= 8 && /\d/.test(password);
}

export async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function signToken({ userId, address, tokenVersion }) {
  return jwt.sign({ sub: userId, address, tokenVersion }, config.jwtSecret, {
    expiresIn: TOKEN_TTL,
  });
}

/** Returns the decoded payload, or null if the token is missing/invalid/expired. */
export function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
}

/**
 * Admin sessions are a separate token type from user sessions — the payload
 * shape (`type: "admin"`) is what a stolen/misused user token can't forge
 * its way into, even though both are signed with the same secret. Shorter
 * TTL than a user session since approve/reject is the most consequential
 * action in the whole app.
 */
export function signAdminToken({ adminId, username }) {
  return jwt.sign({ sub: adminId, username, type: "admin" }, config.jwtSecret, {
    expiresIn: ADMIN_TOKEN_TTL,
  });
}

export function verifyAdminToken(token) {
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    return payload.type === "admin" ? payload : null;
  } catch {
    return null;
  }
}

/**
 * Password-reset tokens are handled separately from session JWTs: a random
 * value is emailed to the user, and only its hash is ever stored (see
 * db/users.js), so a database leak alone can't be used to reset accounts.
 */
export function generateResetToken() {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = Date.now() + RESET_TOKEN_TTL_MS;
  return { token, tokenHash, expiresAt };
}

export function hashResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Email-verification OTPs, same "hash only, never store the raw value"
 * principle as reset tokens — but a 6-digit code (not 256 bits of entropy)
 * is brute-forceable if nothing else limits guesses, so this is paired with
 * both an attempt counter (see db/emailOtps.js) and a short TTL.
 */
export function generateOtp() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashOtp(otp) {
  return crypto.createHash("sha256").update(otp).digest("hex");
}
