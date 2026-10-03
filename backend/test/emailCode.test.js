import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

/**
 * Confirming an email with the emailed code.
 *
 * Nothing tested this flow before, which is how the app shipped with no screen
 * that took the code at all. Two properties: the right code confirms the
 * account and the wrong one is limited; and neither endpoint tells a stranger
 * whether an address has an account here.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, "test-email-code.sqlite");

function cleanupDbFiles() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const file = TEST_DB_PATH + suffix;
    if (fs.existsSync(file)) fs.rmSync(file, { force: true, maxRetries: 10, retryDelay: 50 });
  }
}
cleanupDbFiles();

process.env.RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
process.env.VERIFIER_PRIVATE_KEY =
  process.env.VERIFIER_PRIVATE_KEY ||
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
process.env.JWT_SECRET = "test-jwt-secret";
process.env.WALLET_ENCRYPTION_KEY =
  "236d277256c4ac74368580b5be214189ace6dff26eb4e5efe448dbf1c2a1158c";
process.env.DB_PATH = TEST_DB_PATH;

const { db, createUser, getUserById, setEmailOtp, setEmailVerified } = await import("../src/db.js");
const { hashOtp, OTP_MAX_ATTEMPTS } = await import("../src/auth.js");
const { createApp } = await import("../src/app.js");
const { default: request } = await import("supertest");

const app = createApp();
const CODE = "482913";

function makeUser(email) {
  return createUser({
    email,
    passwordHash: "hash",
    walletAddress: ethers.Wallet.createRandom().address,
    encryptedPrivateKey: "iv:tag:ct",
  });
}

function issueCode(user, code = CODE) {
  setEmailOtp({ userId: user.id, otpHash: hashOtp(code), expiresAt: Date.now() + 10 * 60 * 1000 });
}

let waiting, confirmed;

before(() => {
  waiting = makeUser("waiting@college.test");
  confirmed = makeUser("confirmed@college.test");
  setEmailVerified(confirmed.id);
});

after(() => {
  db.close();
  cleanupDbFiles();
});

test("the right code confirms the email and signs the account in", async () => {
  const user = makeUser("right-code@college.test");
  issueCode(user);
  const res = await request(app).post("/auth/verify-email").send({ email: "right-code@college.test", otp: CODE });
  assert.equal(res.status, 200);
  assert.ok(res.body.token);
  assert.equal(getUserById(user.id).email_verified, 1);
});

test("a wrong code is refused, and repeated guesses lock the code", async () => {
  issueCode(waiting);
  for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
    const res = await request(app).post("/auth/verify-email").send({ email: "waiting@college.test", otp: "000000" });
    assert.equal(res.status, 400);
  }
  // Even the right code no longer works once the attempts are spent.
  const res = await request(app).post("/auth/verify-email").send({ email: "waiting@college.test", otp: CODE });
  assert.equal(res.status, 429);
  assert.equal(getUserById(waiting.id).email_verified, 0);
});

test("an expired code is refused", async () => {
  const user = makeUser("expired@college.test");
  setEmailOtp({ userId: user.id, otpHash: hashOtp(CODE), expiresAt: Date.now() - 1 });
  const res = await request(app).post("/auth/verify-email").send({ email: "expired@college.test", otp: CODE });
  assert.equal(res.status, 400);
});

test("confirming never reveals whether an email has an account", async () => {
  const unknown = await request(app).post("/auth/verify-email").send({ email: "nobody@college.test", otp: CODE });
  const done = await request(app).post("/auth/verify-email").send({ email: "confirmed@college.test", otp: CODE });
  const noCode = makeUser("no-code@college.test");
  const none = await request(app).post("/auth/verify-email").send({ email: noCode.email, otp: CODE });

  assert.equal(unknown.status, 400);
  assert.equal(done.status, unknown.status);
  assert.equal(none.status, unknown.status);
  assert.equal(done.body.error, unknown.body.error);
  assert.equal(none.body.error, unknown.body.error);
});

test("asking for a new code never reveals whether an email has an account", async () => {
  const unknown = await request(app).post("/auth/resend-otp").send({ email: "nobody@college.test" });
  const done = await request(app).post("/auth/resend-otp").send({ email: "confirmed@college.test" });
  assert.equal(unknown.status, 200);
  assert.equal(done.status, 200);
  assert.deepEqual(done.body, unknown.body);
});
