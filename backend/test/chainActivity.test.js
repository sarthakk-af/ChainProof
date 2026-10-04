import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

/**
 * The activity log and the public /public/blockchain route that reads it.
 *
 * The property that matters most is the one every public route keeps: no
 * student appears — not a name, not an address. The feed describes students
 * only as "a student", and a drive the public pages don't show yet is not
 * named either.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, "test-chain-activity.sqlite");

function cleanupDbFiles() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const file = TEST_DB_PATH + suffix;
    // Retries because Windows can hold a just-closed SQLite file for a moment.
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

const { db, upsertActor, upsertDrive, addChainActivity, listRecentChainActivity, findChainTx, resetMirrorForNewDeployment } =
  await import("../src/db.js");
const { activityFields } = await import("../src/chainActivity.js");
const { createApp } = await import("../src/app.js");
const { ROLE, STATUS, DRIVE_STATUS, STAGE, OFFER_RESPONSE } = await import("../src/chain.js");
const { default: request } = await import("supertest");

const app = createApp();

const college = ethers.Wallet.createRandom().address;
const company = ethers.Wallet.createRandom().address;
const student = ethers.Wallet.createRandom().address;

let txCounter = 0;
/** Logs one event the way the indexer does, from the event's own arguments. */
function log(contract, event, args, blockNumber) {
  const fields = activityFields(event, args);
  txCounter += 1;
  addChainActivity({
    txHash: ethers.zeroPadValue(ethers.toBeHex(txCounter), 32),
    logIndex: 0,
    blockNumber,
    blockTime: 1_700_000_000 + blockNumber,
    contract,
    event,
    ...fields,
  });
}

function actor(address, role, name) {
  upsertActor({
    address,
    role,
    status: STATUS.Active,
    name,
    college: role === ROLE.College ? null : college,
    registeredAtBlock: 1,
    updatedAtBlock: 1,
  });
}

function drive(id, status, roleTitle) {
  upsertDrive({
    id,
    companyAddress: company,
    collegeAddress: college,
    roleTitle,
    annualPackage: 1200000,
    minCgpaScaled: 0,
    batchYear: 2026,
    applicationDeadline: 2_000_000_000,
    driveDate: 2_000_100_000,
    ipfsHash: "",
    status,
    postedAt: 1_700_000_000,
    blockNumber: 1,
  });
}

before(() => {
  actor(college, ROLE.College, "Test Institute");
  actor(company, ROLE.Company, "Acme Systems");
  actor(student, ROLE.Student, "Student");
  drive(1, DRIVE_STATUS.Approved, "SDE Intern");
  drive(2, DRIVE_STATUS.Proposed, "Secret Role");

  log("ActorRegistry", "ActorRegistered", [college, ROLE.College, "Test Institute", 2], 10);
  log("ActorRegistry", "ActorRegistered", [company, ROLE.Company, "Acme Systems", 1], 11);
  log("ActorRegistry", "ActorApproved", [company, college], 12);
  log("ActorRegistry", "ActorRegistered", [student, ROLE.Student, "Student", 2], 13);
  log("PlacementDrive", "DrivePosted", [1, company, college, "SDE Intern"], 14);
  log("PlacementDrive", "DriveStatusChanged", [1, DRIVE_STATUS.None, DRIVE_STATUS.Proposed, company], 14);
  log("PlacementDrive", "DriveStatusChanged", [1, DRIVE_STATUS.Proposed, DRIVE_STATUS.Approved, college], 15);
  log("PlacementDrive", "DrivePosted", [2, company, college, "Secret Role"], 16);
  log("DriveOutcomes", "StageRecorded", [1, student, company, STAGE.None, STAGE.Offered, "", "", 0], 17);
  log("DriveOutcomes", "OfferAnswered", [1, student, OFFER_RESPONSE.Accepted, 0], 18);
  log("DriveOutcomes", "PlacementChanged", [student, college, 2026, true, 1], 18);
});

after(() => {
  db.close();
  cleanupDbFiles();
});

test("the feed lists events newest first, each with its transaction", async () => {
  const res = await request(app).get("/public/blockchain");
  assert.equal(res.status, 200);
  const { activity } = res.body;
  assert.ok(activity.length > 0);
  for (let i = 1; i < activity.length; i++) {
    assert.ok(activity[i - 1].blockNumber >= activity[i].blockNumber);
  }
  for (const item of activity) assert.match(item.txHash, /^0x[0-9a-f]{64}$/);
  assert.equal(activity[activity.length - 1].text, "Test Institute was set up as the college");
});

test("the feed describes a recorded offer and its acceptance in plain words", async () => {
  const texts = (await request(app).get("/public/blockchain")).body.activity.map((a) => a.text);
  assert.ok(texts.includes("Acme Systems made an offer to a student in the drive “SDE Intern”"));
  assert.ok(texts.includes("A student accepted an offer in the drive “SDE Intern”"));
  assert.ok(texts.includes("The college approved the drive “SDE Intern”"));
  assert.ok(texts.includes("Acme Systems was admitted by the college"));
});

test("no student's address or name appears anywhere in the feed", async () => {
  const body = JSON.stringify((await request(app).get("/public/blockchain")).body);
  assert.ok(!body.toLowerCase().includes(student.toLowerCase().slice(2)));
});

test("a drive the public pages don't show yet is not named", async () => {
  const texts = (await request(app).get("/public/blockchain")).body.activity.map((a) => a.text);
  assert.ok(!texts.some((t) => t.includes("Secret Role")));
  assert.ok(texts.includes("A company posted a drive"));
});

test("a drive's move to Proposed is skipped — it only repeats the posting", async () => {
  const { activity } = (await request(app).get("/public/blockchain")).body;
  const fromBlock14 = activity.filter((a) => a.blockNumber === 14);
  assert.equal(fromBlock14.length, 1);
  assert.equal(fromBlock14[0].event, "DrivePosted");
});

test("the same event logged twice is kept once", () => {
  const before = listRecentChainActivity(100).length;
  const row = {
    txHash: ethers.zeroPadValue(ethers.toBeHex(1), 32),
    logIndex: 0,
    blockNumber: 10,
    contract: "ActorRegistry",
    event: "ActorRegistered",
  };
  addChainActivity(row);
  addChainActivity({ ...row, txHash: row.txHash.toUpperCase().replace("0X", "0x") });
  assert.equal(listRecentChainActivity(100).length, before);
});

test("the route names the network and lists the four contracts", async () => {
  const res = await request(app).get("/public/blockchain");
  assert.deepEqual(
    res.body.contracts.map((c) => c.name).sort(),
    ["ActorRegistry", "DriveOutcomes", "PlacementDrive", "PreparationLog"]
  );
  for (const c of res.body.contracts) assert.match(c.address, /^0x[0-9a-fA-F]{40}$/);
  assert.equal(typeof res.body.network.name, "string");
  assert.equal(typeof res.body.syncedBlock, "number");
});

test("a record's transaction can be found from what the mirror knows about it", async () => {
  // The fifth event logged above is drive 1's posting; the ninth, the offer.
  const posting = ethers.zeroPadValue(ethers.toBeHex(5), 32);
  const offer = ethers.zeroPadValue(ethers.toBeHex(9), 32);
  assert.equal(findChainTx({ event: "DrivePosted", driveId: 1 }), posting);
  assert.equal(
    findChainTx({ event: "StageRecorded", subject: student, driveId: 1, blockNumber: 17 }),
    offer
  );
  assert.equal(findChainTx({ event: "StageRecorded", subject: student, driveId: 1, blockNumber: 99 }), null);

  // And every screen that shows a drive gets it, the public pages included.
  const res = await request(app).get(`/public/drives/1`);
  assert.equal(res.status, 200);
  assert.equal(res.body.drive.postedTx, posting);
});

test("a new deployment empties the log — its transactions are on the old chain", () => {
  resetMirrorForNewDeployment("a-new-deployment");
  assert.equal(listRecentChainActivity(100).length, 0);
});
