import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

/**
 * Covers /visits/announce's validation + authorization branches without a
 * live chain — the on-chain happy path is covered by manual end-to-end passes.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, "test-visits.sqlite");

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

let activeCollegeUser, pendingCollegeUser, companyUser;

before(() => {
  activeCollegeUser = createUser({
    email: "active-college@example.com",
    passwordHash: "hash",
    walletAddress: ethers.Wallet.createRandom().address,
    encryptedPrivateKey: "iv:tag:ct",
  });
  upsertActor({
    address: activeCollegeUser.wallet_address,
    role: ROLE.College,
    status: STATUS.Active,
    name: "Active College",
    college: null,
    registeredAtBlock: 1,
    updatedAtBlock: 1,
  });

  pendingCollegeUser = createUser({
    email: "pending-college@example.com",
    passwordHash: "hash",
    walletAddress: ethers.Wallet.createRandom().address,
    encryptedPrivateKey: "iv:tag:ct",
  });
  upsertActor({
    address: pendingCollegeUser.wallet_address,
    role: ROLE.College,
    status: STATUS.Pending,
    name: "Pending College",
    college: null,
    registeredAtBlock: 1,
    updatedAtBlock: 1,
  });

  companyUser = createUser({
    email: "company@example.com",
    passwordHash: "hash",
    walletAddress: ethers.Wallet.createRandom().address,
    encryptedPrivateKey: "iv:tag:ct",
  });
  upsertActor({
    address: companyUser.wallet_address,
    role: ROLE.Company,
    status: STATUS.Active,
    name: "A Company",
    college: null,
    registeredAtBlock: 1,
    updatedAtBlock: 1,
  });
});

after(() => {
  db.close();
  cleanupDbFiles();
});

test("rejects missing fields", async () => {
  const res = await request(app)
    .post("/visits/announce")
    .set("Authorization", authHeader(activeCollegeUser))
    .send({ companyName: "Microsoft" });
  assert.equal(res.status, 400);
});

test("rejects a still-Pending College", async () => {
  const res = await request(app)
    .post("/visits/announce")
    .set("Authorization", authHeader(pendingCollegeUser))
    .send({ companyName: "Microsoft", ipfsHash: "Qm1", visitDate: 1735689600 });
  assert.equal(res.status, 403);
});

test("rejects a Company trying to announce a visit", async () => {
  const res = await request(app)
    .post("/visits/announce")
    .set("Authorization", authHeader(companyUser))
    .send({ companyName: "Microsoft", ipfsHash: "Qm1", visitDate: 1735689600 });
  assert.equal(res.status, 403);
});
