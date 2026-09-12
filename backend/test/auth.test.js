import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

/**
 * Covers the pieces of the custodial-account system that don't require a live
 * chain connection: password hashing, JWT issuing/verification, the userAuth
 * middleware, private-key encryption round-trip, and DB-level email
 * uniqueness. The full `POST /auth/signup` flow also funds the new wallet
 * on-chain (see treasury.js) — that's covered by the Phase 3 plan's manual
 * end-to-end pass against a real local Hardhat node, same as Phase 2's
 * approve/reject on-chain happy path.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, "test-auth.sqlite");

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
  "236d277256c4ac74368580b5be214189ace6dff26eb4e5efe448dbf1c2a1158c"; // 32 bytes hex, test-only
process.env.DB_PATH = TEST_DB_PATH;

const { db, createUser, getUserByEmail } = await import("../src/db.js");
const { hashPassword, verifyPassword, signToken, verifyToken, signAdminToken } = await import("../src/auth.js");
const { encrypt, decrypt } = await import("../src/crypto.js");
const { userAuth } = await import("../src/middleware/userAuth.js");
const { default: request } = await import("supertest");

after(() => {
  db.close();
  cleanupDbFiles();
});

test("hashPassword + verifyPassword round-trip", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.notEqual(hash, "correct horse battery staple");
  assert.equal(await verifyPassword("correct horse battery staple", hash), true);
  assert.equal(await verifyPassword("wrong password", hash), false);
});

test("signToken + verifyToken round-trip", () => {
  const token = signToken({ userId: 42, address: "0xabc" });
  const payload = verifyToken(token);
  assert.equal(payload.sub, 42);
  assert.equal(payload.address, "0xabc");
});

test("verifyToken returns null for garbage input", () => {
  assert.equal(verifyToken("not-a-real-token"), null);
  assert.equal(verifyToken(""), null);
});

test("encrypt + decrypt round-trip a private key", () => {
  const plaintext = "0xdeadbeef00000000000000000000000000000000000000000000000000000001";
  const ciphertext = encrypt(plaintext);
  assert.notEqual(ciphertext, plaintext);
  assert.equal(decrypt(ciphertext), plaintext);
});

test("createUser + getUserByEmail round-trip, duplicate email rejected", () => {
  const user = createUser({
    email: "student@example.com",
    passwordHash: "hashed",
    walletAddress: "0x1111111111111111111111111111111111111111",
    encryptedPrivateKey: "iv:tag:ciphertext",
  });
  assert.equal(user.email, "student@example.com");
  assert.equal(getUserByEmail("student@example.com").id, user.id);

  assert.throws(() =>
    createUser({
      email: "student@example.com",
      passwordHash: "other-hash",
      walletAddress: "0x2222222222222222222222222222222222222222",
      encryptedPrivateKey: "iv:tag:ciphertext2",
    })
  );
});

test("an email differing only by case is the same account", () => {
  // Mail domains don't distinguish case, so Sarthak@Gmail.com and
  // sarthak@gmail.com are one inbox. Treating them as two accounts meant two
  // custodial wallets funded from the treasury for one person, and a user who
  // signed up with one capitalisation and typed another at login was simply
  // told "invalid credentials" with no way to find out why.
  const user = createUser({
    email: "MixedCase@Example.com",
    passwordHash: "hashed",
    walletAddress: "0x3333333333333333333333333333333333333333",
    encryptedPrivateKey: "iv:tag:ciphertext",
  });
  assert.equal(user.email, "mixedcase@example.com", "stored lowercased");

  for (const variant of [
    "mixedcase@example.com",
    "MixedCase@Example.com",
    "MIXEDCASE@EXAMPLE.COM",
    "  MixedCase@Example.com  ",
  ]) {
    assert.equal(getUserByEmail(variant)?.id, user.id, `lookup failed for ${variant}`);
  }

  // And a second signup under a different capitalisation must be refused.
  assert.throws(() =>
    createUser({
      email: "MIXEDCASE@example.com",
      passwordHash: "other-hash",
      walletAddress: "0x4444444444444444444444444444444444444444",
      encryptedPrivateKey: "iv:tag:ciphertext2",
    })
  );
});

test("userAuth middleware rejects an admin token", async () => {
  // Both token types are signed with the same secret. An admin token's `sub`
  // is an admins-table id — a small autoincrement integer that usually also
  // names a real, unrelated row in the users table. The tokenVersion check
  // happens to catch this today (an admin token carries none, and undefined
  // never equals a number), but that's an accident, not a rule: refusing on
  // type is what stops a later change to that check quietly turning an admin
  // session into someone else's user session.
  const victim = createUser({
    email: "victim@example.com",
    passwordHash: "hashed",
    walletAddress: "0x5555555555555555555555555555555555555555",
    encryptedPrivateKey: "iv:tag:ciphertext",
  });

  const app = express();
  app.get("/protected", userAuth, (req, res) => res.json({ ok: true, user: req.user }));

  // Deliberately point the admin token's sub at a real user id.
  const adminToken = signAdminToken({ adminId: victim.id, username: "sarthak" });
  const res = await request(app).get("/protected").set("Authorization", `Bearer ${adminToken}`);
  assert.equal(res.status, 401);
  assert.match(res.body.error, /admin sessions/i);
});

test("userAuth middleware rejects a missing token", async () => {
  const app = express();
  app.get("/protected", userAuth, (req, res) => res.json({ ok: true, user: req.user }));

  const res = await request(app).get("/protected");
  assert.equal(res.status, 401);
});

test("userAuth middleware rejects an invalid token", async () => {
  const app = express();
  app.get("/protected", userAuth, (req, res) => res.json({ ok: true, user: req.user }));

  const res = await request(app).get("/protected").set("Authorization", "Bearer garbage");
  assert.equal(res.status, 401);
});

test("userAuth middleware accepts a valid token and attaches req.user", async () => {
  const app = express();
  app.get("/protected", userAuth, (req, res) => res.json({ ok: true, user: req.user }));

  // userAuth now cross-checks the token's version against a real DB row
  // (that's what makes logout/password-reset actually invalidate a token),
  // so this needs a real user, not just an arbitrary id.
  const user = createUser({
    email: "middleware-check@example.com",
    passwordHash: "hash",
    walletAddress: "0xdead000000000000000000000000000000dead",
    encryptedPrivateKey: "iv:tag:ct",
  });
  const token = signToken({ userId: user.id, address: user.wallet_address, tokenVersion: user.token_version });
  const res = await request(app).get("/protected").set("Authorization", `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.user.id, user.id);
  assert.equal(res.body.user.address, user.wallet_address);
});

test("userAuth middleware rejects a token whose version no longer matches the user's", async () => {
  const app = express();
  app.get("/protected", userAuth, (req, res) => res.json({ ok: true, user: req.user }));

  const user = createUser({
    email: "stale-version@example.com",
    passwordHash: "hash",
    walletAddress: "0xbeef000000000000000000000000000000beef",
    encryptedPrivateKey: "iv:tag:ct",
  });
  // Signed as if the user's token_version were already 1, but it's actually 0.
  const token = signToken({ userId: user.id, address: user.wallet_address, tokenVersion: 1 });
  const res = await request(app).get("/protected").set("Authorization", `Bearer ${token}`);
  assert.equal(res.status, 401);
});
