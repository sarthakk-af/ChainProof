import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

/**
 * Covers the public accountability dashboard's backend: all of it is
 * DB-only aggregation over the already-indexed cache, so it's fully testable
 * without a live chain — same pattern as admin.test.js.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, "test-public.sqlite");

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

const { db, upsertActor, upsertCredential, upsertVisit } = await import("../src/db.js");
const { createApp } = await import("../src/app.js");
const { ROLE, STATUS } = await import("../src/chain.js");
const { default: request } = await import("supertest");

const app = createApp();

const college1 = ethers.Wallet.createRandom().address;
const college2 = ethers.Wallet.createRandom().address;
const company1 = ethers.Wallet.createRandom().address;
const student1 = ethers.Wallet.createRandom().address;
const student2 = ethers.Wallet.createRandom().address;
const student3 = ethers.Wallet.createRandom().address;

before(() => {
  upsertActor({ address: college1, role: ROLE.College, status: STATUS.Active, name: "IIT Bombay", college: null, registeredAtBlock: 1, updatedAtBlock: 1 });
  upsertActor({ address: college2, role: ROLE.College, status: STATUS.Active, name: "IIT Delhi", college: null, registeredAtBlock: 2, updatedAtBlock: 2 });
  upsertActor({ address: company1, role: ROLE.Company, status: STATUS.Active, name: "Google", college: null, registeredAtBlock: 3, updatedAtBlock: 3 });

  // college1: 2 students, 1 placed (50%)
  upsertActor({ address: student1, role: ROLE.Student, status: STATUS.Active, name: "Alice", college: college1, registeredAtBlock: 4, updatedAtBlock: 4 });
  upsertActor({ address: student2, role: ROLE.Student, status: STATUS.Active, name: "Bob", college: college1, registeredAtBlock: 5, updatedAtBlock: 5 });
  // college2: 1 student, 1 placed (100%)
  upsertActor({ address: student3, role: ROLE.Student, status: STATUS.Active, name: "Carol", college: college2, registeredAtBlock: 6, updatedAtBlock: 6 });

  upsertCredential({ id: 0, studentAddress: student1, issuerAddress: company1, ipfsHash: "Qm1", credType: 3, timestamp: 1000, blockNumber: 7 });
  upsertCredential({ id: 1, studentAddress: student3, issuerAddress: company1, ipfsHash: "Qm2", credType: 3, timestamp: 1001, blockNumber: 8 });
  // A non-offer credential for student2 shouldn't count as placed.
  upsertCredential({ id: 2, studentAddress: student2, issuerAddress: company1, ipfsHash: "Qm3", credType: 1, timestamp: 1002, blockNumber: 9 });

  upsertVisit({ id: 0, collegeAddress: college1, companyName: "Microsoft", ipfsHash: "QmV1", visitDate: 2000, timestamp: 1003, blockNumber: 10 });
  upsertVisit({ id: 1, collegeAddress: college2, companyName: "Amazon", ipfsHash: "QmV2", visitDate: 2001, timestamp: 1004, blockNumber: 11 });
});

after(() => {
  db.close();
  cleanupDbFiles();
});

test("GET /public/overview reports correct platform-wide totals", async () => {
  const res = await request(app).get("/public/overview");
  assert.equal(res.status, 200);
  assert.equal(res.body.totalColleges, 2);
  assert.equal(res.body.totalCompanies, 1);
  assert.equal(res.body.totalStudents, 3);
  assert.equal(res.body.totalPlaced, 2);
  // 2 placed / 3 students = 66.67%
  assert.equal(res.body.overallPlacementPercentage, 66.67);
});

test("GET /public/colleges merges per-college stats and keeps them isolated", async () => {
  const res = await request(app).get("/public/colleges");
  assert.equal(res.status, 200);
  assert.equal(res.body.colleges.length, 2);

  const c1 = res.body.colleges.find((c) => c.address === college1);
  const c2 = res.body.colleges.find((c) => c.address === college2);

  assert.equal(c1.registered, 2);
  assert.equal(c1.placed, 1);
  assert.equal(c1.percentage, 50);

  assert.equal(c2.registered, 1);
  assert.equal(c2.placed, 1);
  assert.equal(c2.percentage, 100);
});

test("GET /public/colleges returns 0% for a college with no students", async () => {
  upsertActor({ address: ethers.Wallet.createRandom().address, role: ROLE.College, status: STATUS.Active, name: "Empty College", college: null, registeredAtBlock: 12, updatedAtBlock: 12 });
  const res = await request(app).get("/public/colleges");
  const empty = res.body.colleges.find((c) => c.name === "Empty College");
  assert.equal(empty.registered, 0);
  assert.equal(empty.placed, 0);
  assert.equal(empty.percentage, 0);
});

test("GET /public/visits returns recent visits newest-first with college names", async () => {
  const res = await request(app).get("/public/visits");
  assert.equal(res.status, 200);
  assert.equal(res.body.visits.length, 2);
  assert.equal(res.body.visits[0].companyName, "Amazon"); // id 1, most recent
  assert.equal(res.body.visits[0].collegeName, "IIT Delhi");
  assert.equal(res.body.visits[1].companyName, "Microsoft");
});

test("GET /public/visits respects the limit query param", async () => {
  const res = await request(app).get("/public/visits?limit=1");
  assert.equal(res.status, 200);
  assert.equal(res.body.visits.length, 1);
});

test("public routes require no authentication", async () => {
  const res = await request(app).get("/public/overview");
  assert.notEqual(res.status, 401);
});
