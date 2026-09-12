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
let collegeUser, otherCollegeUser, ownStudentUser, foreignStudentUser;
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

  // Two colleges and one student each, to pin the authority boundary.
  const mkCollege = (email, name) => {
    const u = createUser({
      email,
      passwordHash: "hash",
      walletAddress: ethers.Wallet.createRandom().address,
      encryptedPrivateKey: "iv:tag:ct",
    });
    upsertActor({
      address: u.wallet_address,
      role: ROLE.College,
      status: STATUS.Active,
      name,
      college: null,
      registeredAtBlock: 1,
      updatedAtBlock: 1,
    });
    return u;
  };
  const mkStudent = (email, name, collegeAddress) => {
    const u = createUser({
      email,
      passwordHash: "hash",
      walletAddress: ethers.Wallet.createRandom().address,
      encryptedPrivateKey: "iv:tag:ct",
    });
    upsertActor({
      address: u.wallet_address,
      role: ROLE.Student,
      status: STATUS.Active,
      name,
      college: collegeAddress,
      registeredAtBlock: 1,
      updatedAtBlock: 1,
    });
    return u;
  };

  collegeUser = mkCollege("college-a@example.com", "College A");
  otherCollegeUser = mkCollege("college-b@example.com", "College B");
  ownStudentUser = mkStudent("own-student@example.com", "Own Student", collegeUser.wallet_address);
  foreignStudentUser = mkStudent("foreign-student@example.com", "Foreign Student", otherCollegeUser.wallet_address);
});

const GOOD_CID = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";

test("a college cannot issue to another college's student", async () => {
  // A college's authority stops at its own students. Without this, any
  // approved college could write records onto people it has no relationship
  // with — and move another institution's public placement figures, which are
  // grouped by the student's own college.
  const res = await request(app)
    .post("/credentials/issue")
    .set("Authorization", authHeader(collegeUser))
    .send({ studentAddress: foreignStudentUser.wallet_address, ipfsHash: GOOD_CID, credType: "General" });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /its own students/i);
});

test("a college cannot issue an Offer, even to its own student", async () => {
  // An Offer is the record that marks a student placed, and placement
  // percentages are exactly what colleges are held accountable for here. A
  // college issuing its own Offers is the self-reported statistic this project
  // exists to replace. The contract enforces it too.
  const res = await request(app)
    .post("/credentials/issue")
    .set("Authorization", authHeader(collegeUser))
    .send({ studentAddress: ownStudentUser.wallet_address, ipfsHash: GOOD_CID, credType: "Offer" });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /only a company can issue an offer/i);
});

test("a company may still issue an Offer to any student", async () => {
  // Companies recruit across institutions, so the college boundary doesn't
  // apply to them — and only they can create the record that means "placed".
  const res = await request(app)
    .post("/credentials/issue")
    .set("Authorization", authHeader(activeCompanyUser))
    .send({ studentAddress: foreignStudentUser.wallet_address, ipfsHash: GOOD_CID, credType: "Offer" });
  // Reaches the chain-writing stage rather than being refused on authority.
  assert.notEqual(res.status, 403);
});

after(() => {
  db.close();
  cleanupDbFiles();
});

test("rejects an invalid studentAddress", async () => {
  const res = await request(app)
    .post("/credentials/issue")
    .set("Authorization", authHeader(activeCompanyUser))
    .send({ studentAddress: "not-an-address", ipfsHash: "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG", credType: "Offer" });
  assert.equal(res.status, 400);
});

test("rejects a missing ipfsHash", async () => {
  const res = await request(app)
    .post("/credentials/issue")
    .set("Authorization", authHeader(activeCompanyUser))
    .send({ studentAddress: validStudentAddress, credType: "Offer" });
  assert.equal(res.status, 400);
});

test("rejects an ipfsHash that isn't a real CID", async () => {
  // This value goes on-chain permanently. A record pointing at a hash that
  // resolves nowhere looks verifiable without being verifiable, which is
  // worse than having no record at all.
  for (const junk of ["Qm1", "hello world", "not-a-hash", "QmTooShort", "0".repeat(46)]) {
    const res = await request(app)
      .post("/credentials/issue")
      .set("Authorization", authHeader(activeCompanyUser))
      .send({ studentAddress: validStudentAddress, ipfsHash: junk, credType: "Offer" });
    assert.equal(res.status, 400, `expected rejection for ${junk}`);
    assert.match(res.body.error, /IPFS hash/i);
  }
});

test("rejects a CIDv0 containing characters base58 excludes", async () => {
  // 0, O, I and l are deliberately absent from base58 because they're the
  // ones people misread — a hash containing them was mistyped or invented.
  const res = await request(app)
    .post("/credentials/issue")
    .set("Authorization", authHeader(activeCompanyUser))
    .send({
      studentAddress: validStudentAddress,
      ipfsHash: "QmO0IlAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPb",
      credType: "Offer",
    });
  assert.equal(res.status, 400);
});

test("rejects an invalid credType", async () => {
  const res = await request(app)
    .post("/credentials/issue")
    .set("Authorization", authHeader(activeCompanyUser))
    .send({ studentAddress: validStudentAddress, ipfsHash: "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG", credType: "NotAType" });
  assert.equal(res.status, 400);
});

test("rejects a caller that is a still-Pending Company", async () => {
  const res = await request(app)
    .post("/credentials/issue")
    .set("Authorization", authHeader(pendingCompanyUser))
    .send({ studentAddress: validStudentAddress, ipfsHash: "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG", credType: "Offer" });
  assert.equal(res.status, 403);
});

test("rejects a caller that is a Student, not an issuer", async () => {
  const res = await request(app)
    .post("/credentials/issue")
    .set("Authorization", authHeader(studentUser))
    .send({ studentAddress: validStudentAddress, ipfsHash: "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG", credType: "Offer" });
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
    .send({ studentAddress: validStudentAddress, ipfsHash: "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG", credType: "Offer" });
  assert.equal(res.status, 403);
});
