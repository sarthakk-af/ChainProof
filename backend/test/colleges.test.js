import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

/**
 * Covers /colleges' pure-DB-read endpoints, plus the one validation branch of
 * /colleges/:address/placement that doesn't require a live chain call.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, "test-colleges.sqlite");

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

const { db, upsertActor, upsertVisit } = await import("../src/db.js");
const { createApp } = await import("../src/app.js");
const { ROLE, STATUS } = await import("../src/chain.js");
const { default: request } = await import("supertest");

const app = createApp();

const activeCollege = ethers.Wallet.createRandom().address;
const pendingCollege = ethers.Wallet.createRandom().address;

before(() => {
  upsertActor({ address: activeCollege, role: ROLE.College, status: STATUS.Active, name: "Active College", college: null, registeredAtBlock: 1, updatedAtBlock: 1 });
  upsertActor({ address: pendingCollege, role: ROLE.College, status: STATUS.Pending, name: "Pending College", college: null, registeredAtBlock: 2, updatedAtBlock: 2 });

  upsertVisit({ id: 0, collegeAddress: activeCollege, companyName: "Microsoft", ipfsHash: "Qm1", visitDate: 1735689600, timestamp: 1000, blockNumber: 3 });
});

after(() => {
  db.close();
  cleanupDbFiles();
});

test("GET /colleges only lists Active colleges", async () => {
  const res = await request(app).get("/colleges");
  assert.equal(res.status, 200);
  assert.equal(res.body.colleges.length, 1);
  assert.equal(res.body.colleges[0].address, activeCollege);
});

test("GET /colleges/:address/visits returns that college's visits", async () => {
  const res = await request(app).get(`/colleges/${activeCollege}/visits`);
  assert.equal(res.status, 200);
  assert.equal(res.body.visits.length, 1);
  assert.equal(res.body.visits[0].companyName, "Microsoft");
});

test("GET /colleges/:address/visits returns empty for a college with none", async () => {
  const res = await request(app).get(`/colleges/${pendingCollege}/visits`);
  assert.equal(res.status, 200);
  assert.equal(res.body.visits.length, 0);
});

test("GET /colleges/:address/placement rejects an invalid address without touching the chain", async () => {
  const res = await request(app).get("/colleges/not-an-address/placement");
  assert.equal(res.status, 400);
});
