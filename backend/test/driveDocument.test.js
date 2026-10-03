import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

/**
 * Job descriptions — stored here, hashed on-chain, shown to whoever reads the drive.
 *
 * The property that matters: the text a student or parent is shown is the text
 * whose hash the company's drive carries on-chain. None of these tests sends a
 * transaction.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, "test-drive-documents.sqlite");

function cleanupDbFiles() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const file = TEST_DB_PATH + suffix;
    if (fs.existsSync(file)) fs.rmSync(file, { force: true, maxRetries: 10, retryDelay: 50 });
  }
}
cleanupDbFiles();

process.env.RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
process.env.VERIFIER_PRIVATE_KEY =
  process.env.VERIFIER_PRIVATE_KEY ||
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
process.env.JWT_SECRET = "test-jwt-secret";
process.env.WALLET_ENCRYPTION_KEY =
  "236d277256c4ac74368580b5be214189ace6dff26eb4e5efe448dbf1c2a1158c";
process.env.DB_PATH = TEST_DB_PATH;

const { db, createUser, upsertActor, upsertDrive, saveDriveDocument, resetMirrorForNewDeployment } =
  await import("../src/db.js");
const { cidFor, parseDescription, buildDriveDocument, MAX_DESCRIPTION_BYTES } = await import(
  "../src/driveDocument.js"
);
const { validateIpfsHash } = await import("../src/ipfsHash.js");
const { createApp } = await import("../src/app.js");
const { signToken } = await import("../src/auth.js");
const { ROLE, STATUS, DRIVE_STATUS } = await import("../src/chain.js");
const { default: request } = await import("supertest");

const app = createApp();

function authHeader(user) {
  return `Bearer ${signToken({ userId: user.id, address: user.wallet_address, tokenVersion: user.token_version })}`;
}

function makeAccount({ email, role, name, collegeAddress = null }) {
  const address = ethers.Wallet.createRandom().address;
  const user = createUser({ email, passwordHash: "hash", walletAddress: address, encryptedPrivateKey: "iv:tag:ct" });
  upsertActor({ address, role, status: STATUS.Active, name, college: collegeAddress, registeredAtBlock: 1, updatedAtBlock: 1 });
  return user;
}

const TERMS = {
  roleTitle: "Software Engineer",
  annualPackage: 650000,
  minCgpaScaled: 700,
  batchYear: 2026,
  applicationDeadline: Math.floor(Date.now() / 1000) + 86400,
  driveDate: Math.floor(Date.now() / 1000) + 172800,
};

let college, company, student, documentCid;

before(() => {
  college = makeAccount({ email: "cell@college.test", role: ROLE.College, name: "Test Institute" });
  company = makeAccount({ email: "hr@acme.test", role: ROLE.Company, name: "Acme Ltd" });
  student = makeAccount({
    email: "asha@college.test",
    role: ROLE.Student,
    name: "Student",
    collegeAddress: college.wallet_address,
  });

  const document = buildDriveDocument({ ...TERMS, description: "Build the billing API.\n\nTwo rounds." });
  saveDriveDocument(document.cid, document.content);
  documentCid = document.cid;

  upsertDrive({
    id: 1,
    companyAddress: company.wallet_address,
    collegeAddress: college.wallet_address,
    ...TERMS,
    ipfsHash: document.cid,
    status: DRIVE_STATUS.Approved,
    postedAt: 1,
    blockNumber: 1,
  });
  // A drive whose hash points at nothing this platform holds.
  upsertDrive({
    id: 2,
    companyAddress: company.wallet_address,
    collegeAddress: college.wallet_address,
    ...TERMS,
    ipfsHash: "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG",
    status: DRIVE_STATUS.Approved,
    postedAt: 1,
    blockNumber: 1,
  });
});

after(() => {
  db.close();
  cleanupDbFiles();
});

// --- the hash -------------------------------------------------------------------

test("the hash is a standard CIDv1, matching IPFS's own value", () => {
  // The published CID of empty content (raw codec, sha2-256).
  assert.equal(cidFor(""), "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku");
});

test("the hash passes the CID check the contract-facing routes apply", () => {
  assert.equal(validateIpfsHash(cidFor("anything")).error, undefined);
});

test("the same drive always produces the same document and hash", () => {
  const a = buildDriveDocument({ ...TERMS, description: "Same" });
  const b = buildDriveDocument({ ...TERMS, description: "Same" });
  assert.equal(a.content, b.content);
  assert.equal(a.cid, b.cid);
});

test("any change to the description changes the hash", () => {
  const a = buildDriveDocument({ ...TERMS, description: "Two rounds." });
  const b = buildDriveDocument({ ...TERMS, description: "Three rounds." });
  assert.notEqual(a.cid, b.cid);
});

// --- the description ------------------------------------------------------------

test("a description keeps its paragraphs and loses control characters", () => {
  assert.equal(parseDescription("One.\r\n\r\n\r\n\r\nTwo.\u0007").value, "One.\n\nTwo.");
});

test("an empty description is no description", () => {
  assert.equal(parseDescription("   \n ").value, null);
  assert.equal(parseDescription(undefined).value, null);
});

test("an over-long or non-text description is refused", () => {
  assert.match(parseDescription("x".repeat(MAX_DESCRIPTION_BYTES + 1)).error, /bytes or fewer/);
  assert.match(parseDescription({ text: "hi" }).error, /must be text/);
});

test("posting a drive with an over-long description is refused before anything is sent", async () => {
  const res = await request(app)
    .post("/drives")
    .set("Authorization", authHeader(company))
    .send({
      collegeAddress: college.wallet_address,
      roleTitle: "SDE",
      annualPackage: 650000,
      batchYear: 2026,
      applicationDeadline: TERMS.applicationDeadline,
      driveDate: TERMS.driveDate,
      description: "x".repeat(MAX_DESCRIPTION_BYTES + 1),
    });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /description/);
});

// --- who sees it ----------------------------------------------------------------

test("a student browsing open drives sees the description", async () => {
  const res = await request(app).get("/drives/open").set("Authorization", authHeader(student));
  const drive = res.body.drives.find((d) => d.id === 1);
  assert.equal(drive.description, "Build the billing API.\n\nTwo rounds.");
  assert.equal(drive.ipfsHash, documentCid);
});

test("the public drive page shows it, and its hash matches the on-chain pointer", async () => {
  const res = await request(app).get("/public/drives/1");
  assert.equal(res.body.drive.description, "Build the billing API.\n\nTwo rounds.");
  const rebuilt = buildDriveDocument({ ...TERMS, description: res.body.drive.description });
  assert.equal(rebuilt.cid, res.body.drive.ipfsHash);
});

test("the college deciding whether to host sees it", async () => {
  const res = await request(app).get("/college/drives").set("Authorization", authHeader(college));
  assert.equal(res.body.drives.find((d) => d.id === 1).description, "Build the billing API.\n\nTwo rounds.");
});

test("a drive whose document this platform never held has no description, not an error", async () => {
  const res = await request(app).get("/public/drives/2");
  assert.equal(res.status, 200);
  assert.equal(res.body.drive.description, null);
});

test("a chain reset keeps the documents — they are not chain data", async () => {
  resetMirrorForNewDeployment("test-redeploy");
  const row = db.prepare("SELECT 1 FROM drive_documents WHERE cid = ?").get(documentCid);
  assert.ok(row);
});
