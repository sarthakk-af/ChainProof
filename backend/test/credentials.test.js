import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

/**
 * Covers /credentials/issue's validation + authorization branches without a
 * live chain. The on-chain issuance happy path is covered by manual
 * end-to-end passes, same as the rest of this project's chain-touching routes.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, "test-credentials.sqlite");

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

let activeCompanyUser, pendingCompanyUser, studentUser;
const validStudentAddress = ethers.Wallet.createRandom().address;

before(() => {
  activeCompanyUser = createUser({
    email: "active-co@example.com",
    passwordHash: "hash",
    walletAddress: ethers.Wallet.createRandom().address,
    encryptedPrivateKey: "iv:tag:ct",
  });
  upsertActor({
    address: activeCompanyUser.wallet_address,
    role: ROLE.Company,
    status: STATUS.Active,
    name: "Active Co",
    college: null,
    registeredAtBlock: 1,
    updatedAtBlock: 1,
  });

  pendingCompanyUser = createUser({
    email: "pending-co@example.com",
    passwordHash: "hash",
    walletAddress: ethers.Wallet.createRandom().address,
    encryptedPrivateKey: "iv:tag:ct",
  });
  upsertActor({
    address: pendingCompanyUser.wallet_address,
    role: ROLE.Company,
    status: STATUS.Pending,
    name: "Pending Co",
    college: null,
    registeredAtBlock: 1,
    updatedAtBlock: 1,
  });

  studentUser = createUser({
    email: "student@example.com",
    passwordHash: "hash",
    walletAddress: ethers.Wallet.createRandom().address,
    encryptedPrivateKey: "iv:tag:ct",
  });
  upsertActor({
    address: studentUser.wallet_address,
    role: ROLE.Student,
    status: STATUS.Active,
    name: "A Student",
    college: null,
    registeredAtBlock: 1,
    updatedAtBlock: 1,
  });
});

after(() => {
  db.close();
  cleanupDbFiles();
});

test("rejects an invalid studentAddress", async () => {
  const res = await request(app)
    .post("/credentials/issue")
    .set("Authorization", authHeader(activeCompanyUser))
    .send({ studentAddress: "not-an-address", ipfsHash: "Qm1", credType: "Offer" });
  assert.equal(res.status, 400);
});

test("rejects a missing ipfsHash", async () => {
  const res = await request(app)
    .post("/credentials/issue")
    .set("Authorization", authHeader(activeCompanyUser))
    .send({ studentAddress: validStudentAddress, credType: "Offer" });
  assert.equal(res.status, 400);
});

test("rejects an invalid credType", async () => {
  const res = await request(app)
    .post("/credentials/issue")
    .set("Authorization", authHeader(activeCompanyUser))
    .send({ studentAddress: validStudentAddress, ipfsHash: "Qm1", credType: "NotAType" });
  assert.equal(res.status, 400);
});

test("rejects a caller that is a still-Pending Company", async () => {
  const res = await request(app)
    .post("/credentials/issue")
    .set("Authorization", authHeader(pendingCompanyUser))
    .send({ studentAddress: validStudentAddress, ipfsHash: "Qm1", credType: "Offer" });
  assert.equal(res.status, 403);
});

test("rejects a caller that is a Student, not an issuer", async () => {
  const res = await request(app)
    .post("/credentials/issue")
    .set("Authorization", authHeader(studentUser))
    .send({ studentAddress: validStudentAddress, ipfsHash: "Qm1", credType: "Offer" });
  assert.equal(res.status, 403);
});

test("rejects an unregistered caller", async () => {
  const unregistered = createUser({
    email: "unregistered@example.com",
    passwordHash: "hash",
    walletAddress: ethers.Wallet.createRandom().address,
    encryptedPrivateKey: "iv:tag:ct",
  });
  const res = await request(app)
    .post("/credentials/issue")
    .set("Authorization", authHeader(unregistered))
    .send({ studentAddress: validStudentAddress, ipfsHash: "Qm1", credType: "Offer" });
  assert.equal(res.status, 403);
});
