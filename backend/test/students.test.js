import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

/**
 * Covers /students' endpoints — which serve personal data about identifiable
 * people (names, institution, employment outcome, full credential history) and
 * are therefore all behind a session. These tests pin both the data shape and
 * who is allowed to see it.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, "test-students.sqlite");

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

const { db, upsertActor, upsertCredential, createUser } = await import("../src/db.js");
const { createApp } = await import("../src/app.js");
const { ROLE, STATUS } = await import("../src/chain.js");
const { signToken } = await import("../src/auth.js");
const { default: request } = await import("supertest");

const app = createApp();

const college1 = ethers.Wallet.createRandom().address;
const college2 = ethers.Wallet.createRandom().address;
const student1 = ethers.Wallet.createRandom().address; // placed
const student2 = ethers.Wallet.createRandom().address; // no activity, college1
const student3 = ethers.Wallet.createRandom().address; // college2

const company = ethers.Wallet.createRandom().address;
let companyToken, college1Token, college2Token, student1Token, student3Token;

/** A session token for an address that already has an actor row. */
let userSeq = 0;
function tokenFor(address) {
  const user = createUser({
    email: `students-test-${userSeq++}@example.com`,
    passwordHash: "hash",
    walletAddress: address,
    encryptedPrivateKey: "iv:tag:ct",
  });
  return `Bearer ${signToken({ userId: user.id, address, tokenVersion: user.token_version })}`;
}

before(() => {
  upsertActor({ address: student1, role: ROLE.Student, status: STATUS.Active, name: "Alice", college: college1, registeredAtBlock: 1, updatedAtBlock: 1 });
  upsertActor({ address: student2, role: ROLE.Student, status: STATUS.Active, name: "Bob", college: college1, registeredAtBlock: 2, updatedAtBlock: 2 });
  upsertActor({ address: student3, role: ROLE.Student, status: STATUS.Active, name: "Carol", college: college2, registeredAtBlock: 3, updatedAtBlock: 3 });
  upsertActor({ address: college1, role: ROLE.College, status: STATUS.Active, name: "College One", college: null, registeredAtBlock: 1, updatedAtBlock: 1 });
  upsertActor({ address: college2, role: ROLE.College, status: STATUS.Active, name: "College Two", college: null, registeredAtBlock: 1, updatedAtBlock: 1 });
  upsertActor({ address: company, role: ROLE.Company, status: STATUS.Active, name: "Hiring Co", college: null, registeredAtBlock: 1, updatedAtBlock: 1 });

  upsertCredential({ id: 0, studentAddress: student1, issuerAddress: college1, ipfsHash: "Qm1", credType: 3, timestamp: 1000, blockNumber: 4 });

  companyToken = tokenFor(company);
  college1Token = tokenFor(college1);
  college2Token = tokenFor(college2);
  student1Token = tokenFor(student1);
  student3Token = tokenFor(student3);
});

after(() => {
  db.close();
  cleanupDbFiles();
});

test("GET /students is not reachable without a session", async () => {
  // This used to be wide open: real names, institution, and whether each
  // person has a job, to anyone who asked.
  const res = await request(app).get("/students");
  assert.equal(res.status, 401);
});

test("GET /students/:address/credentials is not reachable without a session", async () => {
  const res = await request(app).get(`/students/${student1}/credentials`);
  assert.equal(res.status, 401);
});

test("a verified company sees every student, enriched with stage/placed status", async () => {
  const res = await request(app).get("/students").set("Authorization", companyToken);
  assert.equal(res.status, 200);
  assert.equal(res.body.students.length, 3);

  const alice = res.body.students.find((s) => s.address === student1);
  assert.equal(alice.isPlaced, true);
  assert.equal(alice.highestCredentialStage, "Offer");

  const bob = res.body.students.find((s) => s.address === student2);
  assert.equal(bob.isPlaced, false);
  assert.equal(bob.highestCredentialStage, null);
});

test("a college sees only its own students, whatever the query string asks for", async () => {
  const res = await request(app).get("/students").set("Authorization", college1Token);
  assert.equal(res.status, 200);
  assert.equal(res.body.students.length, 2);
  assert.ok(res.body.students.every((s) => s.college === college1));

  // Explicitly asking for the other college's roster must not work.
  const spoof = await request(app)
    .get(`/students?college=${college2}`)
    .set("Authorization", college1Token);
  assert.equal(spoof.status, 200);
  assert.ok(spoof.body.students.every((s) => s.college === college1), "filter override must be ignored");
});

test("a student cannot enumerate other students", async () => {
  const res = await request(app).get("/students").set("Authorization", student1Token);
  assert.equal(res.status, 403);
});

test("a student can read their own credential history", async () => {
  const res = await request(app)
    .get(`/students/${student1}/credentials`)
    .set("Authorization", student1Token);
  assert.equal(res.status, 200);
  assert.equal(res.body.credentials.length, 1);
  assert.equal(res.body.credentials[0].credType, "Offer");
});

test("a fellow student cannot read someone else's history", async () => {
  const res = await request(app)
    .get(`/students/${student1}/credentials`)
    .set("Authorization", student3Token);
  assert.equal(res.status, 403);
});

test("the student's own college can read it; an unrelated college cannot", async () => {
  const own = await request(app)
    .get(`/students/${student1}/credentials`)
    .set("Authorization", college1Token);
  assert.equal(own.status, 200);

  const other = await request(app)
    .get(`/students/${student1}/credentials`)
    .set("Authorization", college2Token);
  assert.equal(other.status, 403);
});

test("returns an empty history for a student with none", async () => {
  const res = await request(app)
    .get(`/students/${student2}/credentials`)
    .set("Authorization", companyToken);
  assert.equal(res.status, 200);
  assert.equal(res.body.credentials.length, 0);
});
