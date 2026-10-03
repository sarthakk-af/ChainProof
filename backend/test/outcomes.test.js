import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

/**
 * Offers, answers and called-off drives — the mirror and the routes.
 *
 * Two rules from DriveOutcomes that the backend has to keep in step with:
 *   - a new offer is a new question, so it clears the earlier answer;
 *   - a cancelled drive's offer can't be accepted, only withdrawn.
 * None of these tests sends a transaction: each checks what is decided before
 * the chain is reached, or what the mirror does with an event.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, "test-outcomes.sqlite");

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

const {
  db,
  createUser,
  upsertActor,
  upsertDrive,
  addApplication,
  addOutcome,
  setOfferResponse,
  getOfferResponse,
  getCurrentStages,
} = await import("../src/db.js");
const { syncStageRecorded } = await import("../src/indexer.js");
const { createApp } = await import("../src/app.js");
const { signToken } = await import("../src/auth.js");
const { ROLE, STATUS, DRIVE_STATUS, STAGE, OFFER_RESPONSE } = await import("../src/chain.js");
const { default: request } = await import("supertest");

const app = createApp();

function authHeader(user) {
  return `Bearer ${signToken({
    userId: user.id,
    address: user.wallet_address,
    tokenVersion: user.token_version,
  })}`;
}

function makeAccount({ email, role, name, collegeAddress = null }) {
  const address = ethers.Wallet.createRandom().address;
  const user = createUser({
    email,
    passwordHash: "hash",
    walletAddress: address,
    encryptedPrivateKey: "iv:tag:ct",
  });
  upsertActor({
    address,
    role,
    status: STATUS.Active,
    name,
    college: collegeAddress,
    registeredAtBlock: 1,
    updatedAtBlock: 1,
  });
  return user;
}

let college, company, student;
let nextDriveId = 1;

/** A drive with `student` applied and holding an offer. */
function driveWithOffer(status) {
  const id = nextDriveId++;
  upsertDrive({
    id,
    companyAddress: company.wallet_address,
    collegeAddress: college.wallet_address,
    roleTitle: "Software Engineer",
    annualPackage: 650000,
    minCgpaScaled: 0,
    batchYear: 2026,
    applicationDeadline: Math.floor(Date.now() / 1000) + 86400,
    driveDate: Math.floor(Date.now() / 1000) + 172800,
    ipfsHash: "QmTest",
    status,
    postedAt: 1,
    blockNumber: 1,
  });
  addApplication(id, student.wallet_address);
  addOutcome({
    driveId: id,
    studentAddress: student.wallet_address,
    stage: STAGE.Offered,
    previousStage: STAGE.None,
    label: null,
    ipfsHash: null,
    timestamp: 1,
    blockNumber: 10,
  });
  return id;
}

/** The args StageRecorded carries, in event order. */
function stageEvent(driveId, previousStage, newStage) {
  return [driveId, student.wallet_address, company.wallet_address, previousStage, newStage, "", "", 1];
}

before(() => {
  college = makeAccount({ email: "cell@college.test", role: ROLE.College, name: "Test Institute" });
  company = makeAccount({ email: "hr@acme.test", role: ROLE.Company, name: "Acme Ltd" });
  student = makeAccount({
    email: "asha@college.test",
    role: ROLE.Student,
    name: "Student",
    collegeAddress: college.wallet_address,
  });
});

after(() => {
  db.close();
  cleanupDbFiles();
});

// --- the mirror -----------------------------------------------------------------

test("an offer made again clears the answer to the earlier one", () => {
  const id = driveWithOffer(DRIVE_STATUS.Approved);
  setOfferResponse({
    driveId: id,
    studentAddress: student.wallet_address,
    response: OFFER_RESPONSE.Declined,
    timestamp: 1,
    blockNumber: 11,
  });

  syncStageRecorded(stageEvent(id, STAGE.Interview, STAGE.Offered), { blockNumber: 20 });
  assert.equal(getOfferResponse(id, student.wallet_address), undefined);
});

test("a re-offer seen late does not erase the answer given to it", () => {
  // The answer is in block 30 and the re-offer it answers in block 20. If the
  // mirror processes the re-offer second, the answer must survive.
  const id = driveWithOffer(DRIVE_STATUS.Approved);
  setOfferResponse({
    driveId: id,
    studentAddress: student.wallet_address,
    response: OFFER_RESPONSE.Accepted,
    timestamp: 1,
    blockNumber: 30,
  });

  syncStageRecorded(stageEvent(id, STAGE.Interview, STAGE.Offered), { blockNumber: 20 });
  assert.equal(getOfferResponse(id, student.wallet_address).response, OFFER_RESPONSE.Accepted);
});

test("a withdrawal keeps the answer — it happened", () => {
  const id = driveWithOffer(DRIVE_STATUS.Approved);
  setOfferResponse({
    driveId: id,
    studentAddress: student.wallet_address,
    response: OFFER_RESPONSE.Accepted,
    timestamp: 1,
    blockNumber: 11,
  });

  syncStageRecorded(stageEvent(id, STAGE.Offered, STAGE.NotSelected), { blockNumber: 20 });
  assert.equal(getOfferResponse(id, student.wallet_address).response, OFFER_RESPONSE.Accepted);
});

test("the current stage follows the chain's order, not the order rows arrived in", () => {
  const id = driveWithOffer(DRIVE_STATUS.Approved); // Offered, block 10
  // Block 5's stage was repaired late, so it is inserted after block 10's.
  addOutcome({
    driveId: id,
    studentAddress: student.wallet_address,
    stage: STAGE.Shortlisted,
    previousStage: STAGE.None,
    label: null,
    ipfsHash: null,
    timestamp: 1,
    blockNumber: 5,
  });

  const [current] = getCurrentStages(id);
  assert.equal(current.stage, STAGE.Offered);
});

// --- the routes -----------------------------------------------------------------

test("an offer from a cancelled drive can't be accepted", async () => {
  const id = driveWithOffer(DRIVE_STATUS.Cancelled);
  const res = await request(app)
    .post(`/outcomes/${id}/answer`)
    .set("Authorization", authHeader(student))
    .send({ response: "Accepted" });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /called off/);
});

test("a cancelled drive's offer isn't shown as waiting for an answer", async () => {
  const id = driveWithOffer(DRIVE_STATUS.Cancelled);
  const res = await request(app)
    .get("/drives/my-applications")
    .set("Authorization", authHeader(student));
  const app_ = res.body.applications.find((a) => a.driveId === id);
  assert.equal(app_.awaitingResponse, false);
  assert.equal(app_.driveStatus, "Cancelled");
});

test("a cancelled drive takes no new stages other than 'not selected'", async () => {
  const id = driveWithOffer(DRIVE_STATUS.Cancelled);
  for (const stage of ["Shortlisted", "Assessment", "Interview", "Offered"]) {
    const res = await request(app)
      .post(`/outcomes/${id}/stage`)
      .set("Authorization", authHeader(company))
      .send({ studentAddress: student.wallet_address, stage });
    assert.equal(res.status, 409, stage);
    assert.match(res.body.error, /only mark applicants as not selected/);
  }
});

test("a drive the college declined takes no stages at all", async () => {
  const id = driveWithOffer(DRIVE_STATUS.Rejected);
  const res = await request(app)
    .post(`/outcomes/${id}/stage`)
    .set("Authorization", authHeader(company))
    .send({ studentAddress: student.wallet_address, stage: "NotSelected" });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /isn't accepting outcomes/);
});

// --- withdrawing an application ---------------------------------------------------

test("a student can withdraw an application the company hasn't acted on", async () => {
  const id = nextDriveId++;
  upsertDrive({
    id, companyAddress: company.wallet_address, collegeAddress: college.wallet_address,
    roleTitle: "Analyst", annualPackage: 500000, minCgpaScaled: 0, batchYear: 2026,
    applicationDeadline: Math.floor(Date.now() / 1000) + 86400,
    driveDate: Math.floor(Date.now() / 1000) + 172800,
    ipfsHash: "QmTest", status: DRIVE_STATUS.Approved, postedAt: 1, blockNumber: 1,
  });
  addApplication(id, student.wallet_address);

  const res = await request(app).delete(`/drives/${id}/apply`).set("Authorization", authHeader(student));
  assert.equal(res.status, 200);
  const mine = await request(app).get("/drives/my-applications").set("Authorization", authHeader(student));
  assert.ok(!mine.body.applications.some((a) => a.driveId === id));

  const again = await request(app).delete(`/drives/${id}/apply`).set("Authorization", authHeader(student));
  assert.equal(again.status, 404);
});

test("an application the company has acted on can't be withdrawn", async () => {
  const id = driveWithOffer(DRIVE_STATUS.Approved);
  const res = await request(app).delete(`/drives/${id}/apply`).set("Authorization", authHeader(student));
  assert.equal(res.status, 409);
});

test("only a student can withdraw", async () => {
  const res = await request(app).delete("/drives/1/apply").set("Authorization", authHeader(company));
  assert.equal(res.status, 403);
});
