import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

/**
 * Covers what's testable without a live chain connection: auth, the DB-backed
 * listing/filtering logic, and every route branch that returns before it would
 * need to send a real transaction (actor-not-found, actor-not-Pending).
 *
 * The actual on-chain approve/reject happy path is exercised by the manual
 * verification steps in the Phase 2 plan against a real local Hardhat node —
 * spinning up a chain inside this test run would add more fragility than the
 * coverage is worth at this stage.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, "test.sqlite");

function cleanupDbFiles() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const file = TEST_DB_PATH + suffix;
    if (fs.existsSync(file)) fs.rmSync(file);
  }
}

cleanupDbFiles();

process.env.RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
// A well-known, publicly-documented Hardhat local test account key — never used
// on any real network. Only needed here so `ethers.Wallet` can construct
// without throwing; these tests never send a transaction with it.
process.env.VERIFIER_PRIVATE_KEY =
  process.env.VERIFIER_PRIVATE_KEY ||
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
process.env.ADMIN_API_KEY = "test-admin-key";
process.env.JWT_SECRET = "test-jwt-secret";
process.env.WALLET_ENCRYPTION_KEY =
  "236d277256c4ac74368580b5be214189ace6dff26eb4e5efe448dbf1c2a1158c"; // 32 bytes hex, test-only
process.env.DB_PATH = TEST_DB_PATH;

const { db, upsertActor } = await import("../src/db.js");
const { createApp } = await import("../src/app.js");
const { ROLE, STATUS } = await import("../src/chain.js");
const { default: request } = await import("supertest");

const app = createApp();
const ADMIN_HEADER = "test-admin-key";

const collegeAddr = ethers.Wallet.createRandom().address;
const companyAddr = ethers.Wallet.createRandom().address;
const studentAddr = ethers.Wallet.createRandom().address;

before(() => {
  upsertActor({
    address: collegeAddr,
    role: ROLE.College,
    status: STATUS.Pending,
    name: "Test College",
    college: null,
    registeredAtBlock: 1,
    updatedAtBlock: 1,
  });
  upsertActor({
    address: companyAddr,
    role: ROLE.Company,
    status: STATUS.Active,
    name: "Test Company",
    college: null,
    registeredAtBlock: 2,
    updatedAtBlock: 2,
  });
  upsertActor({
    address: studentAddr,
    role: ROLE.Student,
    status: STATUS.Active,
    name: "Test Student",
    college: collegeAddr,
    registeredAtBlock: 3,
    updatedAtBlock: 3,
  });
});

after(() => {
  db.close();
  cleanupDbFiles();
});

test("rejects requests with no admin key", async () => {
  const res = await request(app).get("/admin/actors");
  assert.equal(res.status, 401);
});

test("rejects requests with a wrong admin key", async () => {
  const res = await request(app).get("/admin/actors").set("x-admin-key", "wrong");
  assert.equal(res.status, 401);
});

test("lists all indexed actors", async () => {
  const res = await request(app).get("/admin/actors").set("x-admin-key", ADMIN_HEADER);
  assert.equal(res.status, 200);
  assert.equal(res.body.actors.length, 3);
});

test("filters actors by status", async () => {
  const res = await request(app)
    .get("/admin/actors?status=Pending")
    .set("x-admin-key", ADMIN_HEADER);
  assert.equal(res.status, 200);
  assert.equal(res.body.actors.length, 1);
  assert.equal(res.body.actors[0].address, collegeAddr);
});

test("filters actors by role", async () => {
  const res = await request(app)
    .get("/admin/actors?role=Student")
    .set("x-admin-key", ADMIN_HEADER);
  assert.equal(res.status, 200);
  assert.equal(res.body.actors.length, 1);
  assert.equal(res.body.actors[0].college, collegeAddr);
});

test("rejects an invalid status filter value", async () => {
  const res = await request(app)
    .get("/admin/actors?status=NotARealStatus")
    .set("x-admin-key", ADMIN_HEADER);
  assert.equal(res.status, 400);
});

test("returns actor detail by address", async () => {
  const res = await request(app)
    .get(`/admin/actors/${collegeAddr}`)
    .set("x-admin-key", ADMIN_HEADER);
  assert.equal(res.status, 200);
  assert.equal(res.body.actor.status, "Pending");
  assert.equal(res.body.actor.role, "College");
});

test("returns 404 for an unindexed actor address", async () => {
  const res = await request(app)
    .get(`/admin/actors/${ethers.Wallet.createRandom().address}`)
    .set("x-admin-key", ADMIN_HEADER);
  assert.equal(res.status, 404);
});

test("approve returns 404 for an actor that was never indexed", async () => {
  const res = await request(app)
    .post(`/admin/actors/${ethers.Wallet.createRandom().address}/approve`)
    .set("x-admin-key", ADMIN_HEADER);
  assert.equal(res.status, 404);
});

test("approve returns 409 for an actor that is already Active", async () => {
  const res = await request(app)
    .post(`/admin/actors/${companyAddr}/approve`)
    .set("x-admin-key", ADMIN_HEADER);
  assert.equal(res.status, 409);
});

test("reject returns 409 for an actor that is already Active", async () => {
  const res = await request(app)
    .post(`/admin/actors/${companyAddr}/reject`)
    .set("x-admin-key", ADMIN_HEADER);
  assert.equal(res.status, 409);
});
