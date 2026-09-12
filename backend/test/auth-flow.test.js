import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

/**
 * Covers logout/token-invalidation and password-reset without needing a real
 * email to actually send — BREVO_API_KEY is intentionally left unset here, so
 * sendEmail() fails internally and forgot-password still returns its generic
 * response (exactly as it should for an unconfigured deployment). Actually
 * receiving the email is verified manually once real Brevo credentials exist,
 * same as every other external-service interaction in this project.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, "test-auth-flow.sqlite");

function cleanupDbFiles() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const file = TEST_DB_PATH + suffix;
    if (fs.existsSync(file)) fs.rmSync(file);
  }
}

cleanupDbFiles();

process.env.RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
process.env.VERIFIER_PRIVATE_KEY =
  process.env.VERIFIER_PRIVATE_KEY ||
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
process.env.ADMIN_API_KEY = "test-admin-key";
process.env.JWT_SECRET = "test-jwt-secret";
process.env.WALLET_ENCRYPTION_KEY =
  "236d277256c4ac74368580b5be214189ace6dff26eb4e5efe448dbf1c2a1158c";
process.env.DB_PATH = TEST_DB_PATH;
delete process.env.BREVO_API_KEY;
delete process.env.EMAIL_FROM_ADDRESS;

const { db, createUser, getUserByEmail } = await import("../src/db.js");
const { createApp } = await import("../src/app.js");
const { signToken, verifyPassword } = await import("../src/auth.js");
const { default: request } = await import("supertest");

const app = createApp();

function authHeader(user) {
  const token = signToken({ userId: user.id, address: user.wallet_address, tokenVersion: user.token_version });
  return `Bearer ${token}`;
}

let user;

before(() => {
  user = createUser({
    email: "flow@example.com",
    passwordHash: "$2a$10$placeholderplaceholderplaceholderplaceholderplaceholde", // unused directly
    walletAddress: ethers.Wallet.createRandom().address,
    encryptedPrivateKey: "iv:tag:ct",
  });
});

after(() => {
  db.close();
  cleanupDbFiles();
});

test("a token with a stale tokenVersion is rejected", async () => {
  // Sign a token claiming a version ahead of what's actually stored.
  const staleToken = signToken({ userId: user.id, address: user.wallet_address, tokenVersion: 99 });
  const res = await request(app).get("/me").set("Authorization", `Bearer ${staleToken}`);
  assert.equal(res.status, 401);
});

test("POST /auth/logout bumps the token version, invalidating the token used to call it", async () => {
  const header = authHeader(user);

  const before1 = await request(app).get("/me").set("Authorization", header);
  assert.equal(before1.status, 200);

  const logoutRes = await request(app).post("/auth/logout").set("Authorization", header);
  assert.equal(logoutRes.status, 200);

  const after1 = await request(app).get("/me").set("Authorization", header);
  assert.equal(after1.status, 401);
});

test("POST /auth/logout requires authentication", async () => {
  const res = await request(app).post("/auth/logout");
  assert.equal(res.status, 401);
});

test("POST /auth/forgot-password always returns the generic response, known email or not", async () => {
  const unknown = await request(app).post("/auth/forgot-password").send({ email: "nobody@example.com" });
  assert.equal(unknown.status, 200);
  assert.match(unknown.body.message, /reset link/i);

  const known = await request(app).post("/auth/forgot-password").send({ email: "flow@example.com" });
  assert.equal(known.status, 200);
  assert.match(known.body.message, /reset link/i);
});

test("POST /auth/reset-password rejects a bogus token", async () => {
  const res = await request(app)
    .post("/auth/reset-password")
    .send({ token: "not-a-real-token", newPassword: "brandnewpassword" });
  assert.equal(res.status, 400);
});

test("POST /auth/reset-password rejects a short password", async () => {
  const res = await request(app)
    .post("/auth/reset-password")
    .send({ token: "whatever", newPassword: "short" });
  assert.equal(res.status, 400);
});

test("a full reset cycle changes the password and invalidates old tokens", async () => {
  // Reach into the db module directly to generate a real reset token, since
  // forgot-password doesn't hand the raw token back over HTTP (only email does).
  const { generateResetToken } = await import("../src/auth.js");
  const { createPasswordReset } = await import("../src/db.js");

  const resetUser = createUser({
    email: "resetme@example.com",
    passwordHash: await (await import("../src/auth.js")).hashPassword("originalpassword"),
    walletAddress: ethers.Wallet.createRandom().address,
    encryptedPrivateKey: "iv:tag:ct",
  });

  const { token, tokenHash, expiresAt } = generateResetToken();
  createPasswordReset({ tokenHash, userId: resetUser.id, expiresAt });

  const res = await request(app)
    .post("/auth/reset-password")
    .send({ token, newPassword: "brandnewpassword1" });
  assert.equal(res.status, 200);

  const updated = getUserByEmail("resetme@example.com");
  assert.equal(await verifyPassword("brandnewpassword1", updated.password_hash), true);
  assert.equal(await verifyPassword("originalpassword", updated.password_hash), false);
  assert.equal(updated.token_version, 1); // bumped by the reset

  // The same token can't be reused.
  const reused = await request(app)
    .post("/auth/reset-password")
    .send({ token, newPassword: "yetanotherpassword1" });
  assert.equal(reused.status, 400);
});

test("completing a reset also verifies the email", async () => {
  // Someone who forgets their password before ever entering the OTP has still
  // proved they control the inbox — by opening a link sent to it. Leaving them
  // unverified strands them: the password works, login still refuses, and the
  // original code has long since expired.
  const { generateResetToken, hashPassword } = await import("../src/auth.js");
  const { createPasswordReset } = await import("../src/db.js");

  const unverified = createUser({
    email: "neververified@example.com",
    passwordHash: await hashPassword("originalpassword"),
    walletAddress: ethers.Wallet.createRandom().address,
    encryptedPrivateKey: "iv:tag:ct",
  });
  assert.equal(getUserByEmail("neververified@example.com").email_verified, 0);

  const { token, tokenHash, expiresAt } = generateResetToken();
  createPasswordReset({ tokenHash, userId: unverified.id, expiresAt });

  const res = await request(app)
    .post("/auth/reset-password")
    .send({ token, newPassword: "brandnewpassword1" });
  assert.equal(res.status, 200);

  assert.equal(getUserByEmail("neververified@example.com").email_verified, 1);
});

test("an expired reset token is refused", async () => {
  const { generateResetToken, hashPassword } = await import("../src/auth.js");
  const { createPasswordReset } = await import("../src/db.js");

  const staleUser = createUser({
    email: "staletoken@example.com",
    passwordHash: await hashPassword("originalpassword"),
    walletAddress: ethers.Wallet.createRandom().address,
    encryptedPrivateKey: "iv:tag:ct",
  });

  const { token, tokenHash } = generateResetToken();
  // Backdate it past its lifetime rather than waiting an hour.
  createPasswordReset({ tokenHash, userId: staleUser.id, expiresAt: Date.now() - 1000 });

  const res = await request(app)
    .post("/auth/reset-password")
    .send({ token, newPassword: "brandnewpassword1" });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /invalid or has expired/i);

  // And the password must be untouched.
  const unchanged = getUserByEmail("staletoken@example.com");
  assert.equal(await verifyPassword("originalpassword", unchanged.password_hash), true);
});

test("resetting a password invalidates every other outstanding reset token for that user", async () => {
  // Simulates clicking "forgot password" twice (e.g. the first email was
  // slow) — using the second link shouldn't leave the first one still valid.
  const { generateResetToken } = await import("../src/auth.js");
  const { createPasswordReset } = await import("../src/db.js");

  const twoLinksUser = createUser({
    email: "twolinks@example.com",
    passwordHash: await (await import("../src/auth.js")).hashPassword("originalpassword"),
    walletAddress: ethers.Wallet.createRandom().address,
    encryptedPrivateKey: "iv:tag:ct",
  });

  const first = generateResetToken();
  createPasswordReset({ tokenHash: first.tokenHash, userId: twoLinksUser.id, expiresAt: first.expiresAt });
  const second = generateResetToken();
  createPasswordReset({ tokenHash: second.tokenHash, userId: twoLinksUser.id, expiresAt: second.expiresAt });

  // Use the second link successfully.
  const res = await request(app)
    .post("/auth/reset-password")
    .send({ token: second.token, newPassword: "newerpassword1" });
  assert.equal(res.status, 200);

  // The first (still-unused, still-unexpired) link must no longer work.
  const staleAttempt = await request(app)
    .post("/auth/reset-password")
    .send({ token: first.token, newPassword: "attackerpassword1" });
  assert.equal(staleAttempt.status, 400);
});
