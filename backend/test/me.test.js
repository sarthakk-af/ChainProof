import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

/**
 * Covers /me's validation branches without a live chain — the on-chain
 * registration happy path is covered by this project's manual end-to-end
 * passes, same pattern as every other route touching the blockchain.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, "test-me.sqlite");

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

const { db, createUser, upsertActor } = await import("../src/db.js");
const { createApp } = await import("../src/app.js");
const { signToken } = await import("../src/auth.js");
const { ROLE, STATUS } = await import("../src/chain.js");
const { default: request } = await import("supertest");

const app = createApp();

function authHeader(user) {
  const token = signToken({ userId: user.id, address: user.wallet_address, tokenVersion: user.token_version });
  return `Bearer ${token}`;
}

let plainUser, registeredUser, rejectedUser;

before(() => {
  plainUser = createUser({
    email: "plain@example.com",
    passwordHash: "hash",
    walletAddress: ethers.Wallet.createRandom().address,
    encryptedPrivateKey: "iv:tag:ct",
  });

  registeredUser = createUser({
    email: "registered@example.com",
    passwordHash: "hash",
    walletAddress: ethers.Wallet.createRandom().address,
    encryptedPrivateKey: "iv:tag:ct",
  });
  upsertActor({
    address: registeredUser.wallet_address,
    role: ROLE.Student,
    status: STATUS.Active,
    name: "Already Registered",
    college: null,
    registeredAtBlock: 1,
    updatedAtBlock: 1,
  });

  rejectedUser = createUser({
    email: "rejected@example.com",
    passwordHash: "hash",
    walletAddress: ethers.Wallet.createRandom().address,
    encryptedPrivateKey: "iv:tag:ct",
  });
  upsertActor({
    address: rejectedUser.wallet_address,
    role: ROLE.Company,
    status: STATUS.Rejected,
    name: "Rejected Co",
    college: null,
    registeredAtBlock: 1,
    updatedAtBlock: 1,
  });
});

after(() => {
  db.close();
  cleanupDbFiles();
});

test("GET /me returns profile with a null actor when unregistered", async () => {
  const res = await request(app).get("/me").set("Authorization", authHeader(plainUser));
  assert.equal(res.status, 200);
  assert.equal(res.body.email, "plain@example.com");
  assert.equal(res.body.actor, null);
});

test("GET /me returns the actor once registered", async () => {
  const res = await request(app).get("/me").set("Authorization", authHeader(registeredUser));
  assert.equal(res.status, 200);
  assert.equal(res.body.actor.name, "Already Registered");
  assert.equal(res.body.actor.status, "Active");
});

test("GET /me rejects an unauthenticated request", async () => {
  const res = await request(app).get("/me");
  assert.equal(res.status, 401);
});

test("POST /me/register rejects an invalid role", async () => {
  const res = await request(app)
    .post("/me/register")
    .set("Authorization", authHeader(plainUser))
    .send({ role: "NotARole", name: "Someone" });
  assert.equal(res.status, 400);
});

test("POST /me/register rejects a missing name", async () => {
  const res = await request(app)
    .post("/me/register")
    .set("Authorization", authHeader(plainUser))
    .send({ role: "Company" });
  assert.equal(res.status, 400);
});

test("POST /me/register rejects a Student registration with an invalid collegeAddress", async () => {
  const res = await request(app)
    .post("/me/register")
    .set("Authorization", authHeader(plainUser))
    .send({ role: "Student", name: "A Student", collegeAddress: "not-an-address" });
  assert.equal(res.status, 400);
});

test("POST /me/register rejects an already-registered account", async () => {
  const res = await request(app)
    .post("/me/register")
    .set("Authorization", authHeader(registeredUser))
    .send({ role: "Company", name: "Anything" });
  assert.equal(res.status, 409);
});

test("GET /me shows Rejected status for a rejected actor", async () => {
  const res = await request(app).get("/me").set("Authorization", authHeader(rejectedUser));
  assert.equal(res.status, 200);
  assert.equal(res.body.actor.status, "Rejected");
});

// NOTE: "a Rejected account can resubmit past this 409 check" isn't covered
// here — proving it requires actually reaching the chain-touching code past
// validation (same category of thing this suite already defers elsewhere,
// e.g. admin.test.js's approve/reject happy path). Verified manually instead
// against a live local Hardhat node, same as every other chain-touching fix
// in this project.
