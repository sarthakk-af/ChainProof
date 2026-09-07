import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

/** Covers /students' pure-DB-read endpoints. */

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

const { db, upsertActor, upsertCredential } = await import("../src/db.js");
const { createApp } = await import("../src/app.js");
const { ROLE, STATUS } = await import("../src/chain.js");
const { default: request } = await import("supertest");

const app = createApp();

const college1 = ethers.Wallet.createRandom().address;
const college2 = ethers.Wallet.createRandom().address;
const student1 = ethers.Wallet.createRandom().address; // placed
const student2 = ethers.Wallet.createRandom().address; // no activity, college1
const student3 = ethers.Wallet.createRandom().address; // college2

before(() => {
  upsertActor({ address: student1, role: ROLE.Student, status: STATUS.Active, name: "Alice", college: college1, registeredAtBlock: 1, updatedAtBlock: 1 });
  upsertActor({ address: student2, role: ROLE.Student, status: STATUS.Active, name: "Bob", college: college1, registeredAtBlock: 2, updatedAtBlock: 2 });
  upsertActor({ address: student3, role: ROLE.Student, status: STATUS.Active, name: "Carol", college: college2, registeredAtBlock: 3, updatedAtBlock: 3 });

  upsertCredential({ id: 0, studentAddress: student1, issuerAddress: college1, ipfsHash: "Qm1", credType: 3, timestamp: 1000, blockNumber: 4 });
});

after(() => {
  db.close();
  cleanupDbFiles();
});

test("GET /students lists every student, enriched with stage/placed status", async () => {
  const res = await request(app).get("/students");
  assert.equal(res.status, 200);
  assert.equal(res.body.students.length, 3);

  const alice = res.body.students.find((s) => s.address === student1);
  assert.equal(alice.isPlaced, true);
  assert.equal(alice.highestCredentialStage, "Offer");

  const bob = res.body.students.find((s) => s.address === student2);
  assert.equal(bob.isPlaced, false);
  assert.equal(bob.highestCredentialStage, null);
});

test("GET /students?college= filters to just that college", async () => {
  const res = await request(app).get(`/students?college=${college1}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.students.length, 2);
  assert.ok(res.body.students.every((s) => s.college === college1));
});

test("GET /students/:address/credentials returns that student's history", async () => {
  const res = await request(app).get(`/students/${student1}/credentials`);
  assert.equal(res.status, 200);
  assert.equal(res.body.credentials.length, 1);
  assert.equal(res.body.credentials[0].credType, "Offer");
});

test("GET /students/:address/credentials returns empty for a student with none", async () => {
  const res = await request(app).get(`/students/${student2}/credentials`);
  assert.equal(res.status, 200);
  assert.equal(res.body.credentials.length, 0);
});
