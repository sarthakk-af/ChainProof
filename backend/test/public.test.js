import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

/**
 * The public routes — what anyone can read without an account.
 *
 * Two properties are worth more than everything else here:
 *   - no individual ever appears. Not a name, not a roll number, not one
 *     person's outcome. The institution is accountable; the student who didn't
 *     get picked is not;
 *   - the denominator is shown, not assumed. "92% placed" means nothing until
 *     you know 92% of what, and a college that has quietly restated its batch
 *     size must not be able to present that as a first declaration.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, "test-public.sqlite");

function cleanupDbFiles() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const file = TEST_DB_PATH + suffix;
    // Retries because Windows can hold a just-closed SQLite file for a moment,
    // which otherwise fails the run with EBUSY after every test has passed.
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
  upsertActor,
  upsertBatch,
  upsertDrive,
  upsertProfile,
  upsertRosterEntries,
  claimRosterEntry,
  addOutcome,
  setOfferResponse,
  setPlacement,
} = await import("../src/db.js");
const { createApp } = await import("../src/app.js");
const { ROLE, STATUS, DRIVE_STATUS, STAGE, OFFER_RESPONSE } = await import("../src/chain.js");
const { default: request } = await import("supertest");

const app = createApp();

const college = ethers.Wallet.createRandom().address;
const company = ethers.Wallet.createRandom().address;
const students = Array.from({ length: 3 }, () => ethers.Wallet.createRandom().address);

before(() => {
  upsertActor({
    address: college, role: ROLE.College, status: STATUS.Active, name: "Test Institute",
    college: null, registeredAtBlock: 1, updatedAtBlock: 1,
  });
  upsertActor({
    address: company, role: ROLE.Company, status: STATUS.Active, name: "Acme Corp",
    college: null, registeredAtBlock: 1, updatedAtBlock: 1,
  });

  // A cohort of 180, later restated as 60 — the move that inflates a rate.
  upsertBatch({ collegeAddress: college, courseCode: "CSE", batchYear: 2026, strength: 60, previousStrength: 180, blockNumber: 5 });
  db.prepare("UPDATE batches SET revision_count = 1 WHERE college_address = ?").run(college.toLowerCase());

  upsertRosterEntries(college, students.map((_, i) => ({
    roll_number: `21CE10${41 + i}`,
    full_name: `Private Person ${i + 1}`,
    course_code: "CSE",
    batch_year: 2026,
  })));

  students.forEach((address, i) => {
    upsertActor({
      address, role: ROLE.Student, status: STATUS.Active, name: `Private Person ${i + 1}`,
      college, registeredAtBlock: 2, updatedAtBlock: 2,
    });
    claimRosterEntry(college, `21CE10${41 + i}`, address);
    upsertProfile(address, college, {
      roll_number: `21CE10${41 + i}`,
      full_name: `Private Person ${i + 1}`,
      course_code: "CSE",
      batch_year: 2026,
      cgpa_scaled: 800,
      phone: null,
    });
  });

  upsertDrive({
    id: 1, companyAddress: company, collegeAddress: college, roleTitle: "Software Engineer",
    annualPackage: 650000, minCgpaScaled: 700, batchYear: 2026,
    applicationDeadline: 1900000000, driveDate: 1900100000, ipfsHash: "QmTest",
    status: DRIVE_STATUS.Approved, postedAt: 10, blockNumber: 10,
  });
  db.prepare("UPDATE drives SET application_count = 140 WHERE id = 1").run();

  // A funnel: 3 shortlisted, 2 interviewed, 2 offered, 1 accepted.
  students.forEach((address, i) => {
    addOutcome({ driveId: 1, studentAddress: address, stage: STAGE.Shortlisted, previousStage: STAGE.None, label: "Screen", ipfsHash: null, timestamp: 1000 + i, blockNumber: 11 + i });
  });
  students.slice(0, 2).forEach((address, i) => {
    addOutcome({ driveId: 1, studentAddress: address, stage: STAGE.Interview, previousStage: STAGE.Shortlisted, label: "Tech", ipfsHash: null, timestamp: 2000 + i, blockNumber: 20 + i });
    addOutcome({ driveId: 1, studentAddress: address, stage: STAGE.Offered, previousStage: STAGE.Interview, label: "Final", ipfsHash: null, timestamp: 3000 + i, blockNumber: 30 + i });
  });
  setOfferResponse({ driveId: 1, studentAddress: students[0], response: OFFER_RESPONSE.Accepted, timestamp: 4000, blockNumber: 40 });
  setOfferResponse({ driveId: 1, studentAddress: students[1], response: OFFER_RESPONSE.Declined, timestamp: 4001, blockNumber: 41 });
  setPlacement({ studentAddress: students[0], collegeAddress: college, batchYear: 2026, placed: true, blockNumber: 42 });
});

after(() => {
  db.close();
  cleanupDbFiles();
});

// --- privacy -----------------------------------------------------------------

test("no student name, roll number or address appears anywhere public", async () => {
  const paths = [
    "/public/overview",
    "/public/colleges",
    `/public/colleges/${college}/placement`,
    `/public/colleges/${college}/drives`,
    `/public/colleges/${college}/recruiters`,
    "/public/drives/1",
  ];
  for (const p of paths) {
    const res = await request(app).get(p);
    assert.equal(res.status, 200, `${p} should be readable`);
    const blob = JSON.stringify(res.body);
    assert.ok(!/Private Person/.test(blob), `${p} leaked a student name`);
    assert.ok(!/21CE10/.test(blob), `${p} leaked a roll number`);
    for (const address of students) {
      assert.ok(!blob.toLowerCase().includes(address.toLowerCase()), `${p} leaked a student address`);
    }
  }
});

test("the public routes need no session at all", async () => {
  // The whole point: a parent has no account.
  const res = await request(app).get("/public/overview");
  assert.equal(res.status, 200);
});

// --- the denominator ---------------------------------------------------------

test("placement is published against the declared batch AND against signups", async () => {
  const res = await request(app).get(`/public/colleges/${college}/placement`);
  const batch = res.body.batches.find((b) => b.batchYear === 2026);

  assert.equal(batch.placed, 1);
  assert.equal(batch.declaredStrength, 60);
  assert.equal(batch.registered, 3);
  // Both rates side by side. Quoting only the second is the usual way a
  // placement figure flatters itself.
  assert.equal(batch.placementRateOfBatch, 1.67);
  assert.equal(batch.placementRateOfRegistered, 33.33);
});

test("a restated cohort size is flagged, not presented as a first declaration", async () => {
  const res = await request(app).get(`/public/colleges/${college}/placement`);
  const batch = res.body.batches.find((b) => b.batchYear === 2026);
  assert.ok(batch.declaredStrengthRevisions >= 1, "the revision must be visible");
});

test("an unknown or malformed college returns 404 rather than leaking anything", async () => {
  assert.equal((await request(app).get("/public/colleges/not-an-address/placement")).status, 404);
  assert.equal(
    (await request(app).get(`/public/colleges/${ethers.Wallet.createRandom().address}/placement`)).status,
    404
  );
});

// --- the funnel --------------------------------------------------------------

test("the funnel counts everyone who ever reached a stage", async () => {
  const res = await request(app).get("/public/drives/1");
  const f = res.body.drive.funnel;

  // "Ever reached", not "currently standing": a student shortlisted and later
  // rejected was still shortlisted, and a funnel that forgot them would
  // understate every stage above the last one.
  assert.equal(f.shortlisted, 3);
  assert.equal(f.interviewed, 2);
  assert.equal(f.offered, 2);
  assert.equal(f.accepted, 1);
});

test("applied is the company's signed figure, not a row count", async () => {
  const res = await request(app).get("/public/drives/1");
  assert.equal(res.body.drive.funnel.applied, 140);
});

test("an unstated applicant total reads as null, never as zero", async () => {
  // "Nobody applied" and "not published yet" are different facts, and only one
  // of them is true.
  upsertDrive({
    id: 2, companyAddress: company, collegeAddress: college, roleTitle: "Analyst",
    annualPackage: 800000, minCgpaScaled: 0, batchYear: 2026,
    applicationDeadline: 1900000000, driveDate: 1900100000, ipfsHash: "QmTest2",
    status: DRIVE_STATUS.Approved, postedAt: 50, blockNumber: 50,
  });
  const res = await request(app).get("/public/drives/2");
  assert.equal(res.body.drive.funnel.applied, null);
});

// --- which drives are visible ------------------------------------------------

test("a proposed or rejected drive is not published", async () => {
  // A company the college declined never recruited here, and publishing that
  // would expose a private decision.
  upsertDrive({
    id: 3, companyAddress: company, collegeAddress: college, roleTitle: "Secret Role",
    annualPackage: 1, minCgpaScaled: 0, batchYear: 2026,
    applicationDeadline: 1900000000, driveDate: 1900100000, ipfsHash: "QmTest3",
    status: DRIVE_STATUS.Proposed, postedAt: 60, blockNumber: 60,
  });
  assert.equal((await request(app).get("/public/drives/3")).status, 404);

  const list = await request(app).get(`/public/colleges/${college}/drives`);
  assert.ok(!JSON.stringify(list.body).includes("Secret Role"));
});

test("a cancelled drive IS published", async () => {
  // A student who applied is entitled to the fact that the company withdrew.
  upsertDrive({
    id: 4, companyAddress: company, collegeAddress: college, roleTitle: "Withdrawn Role",
    annualPackage: 500000, minCgpaScaled: 0, batchYear: 2026,
    applicationDeadline: 1900000000, driveDate: 1900100000, ipfsHash: "QmTest4",
    status: DRIVE_STATUS.Cancelled, postedAt: 70, blockNumber: 70,
  });
  const res = await request(app).get("/public/drives/4");
  assert.equal(res.status, 200);
  assert.equal(res.body.drive.status, "Cancelled");
});

test("a declined company never appears among the recruiters", async () => {
  // The drive list withholds a rejected drive; the recruiter summary beside it
  // used to count the same drive anyway, publishing the company and its offer.
  const declined = ethers.Wallet.createRandom().address;
  upsertActor({
    address: declined, role: ROLE.Company, status: STATUS.Active, name: "Declined Ltd",
    college: null, registeredAtBlock: 1, updatedAtBlock: 1,
  });
  upsertDrive({
    id: 9, companyAddress: declined, collegeAddress: college, roleTitle: "Turned Down",
    annualPackage: 9900000, minCgpaScaled: 0, batchYear: 2026,
    applicationDeadline: 1900000000, driveDate: 1900100000, ipfsHash: "QmTest9",
    status: DRIVE_STATUS.Rejected, postedAt: 90, blockNumber: 90,
  });

  const res = await request(app).get(`/public/colleges/${college}/recruiters`);
  const blob = JSON.stringify(res.body);
  assert.ok(!blob.includes("Declined Ltd"), "a declined company was published");
  assert.ok(!blob.includes("9900000"), "a declined offer was published");
});

test("recruiters are summarised with what they actually offered", async () => {
  const res = await request(app).get(`/public/colleges/${college}/recruiters`);
  const acme = res.body.recruiters.find((r) => r.companyName === "Acme Corp");
  assert.ok(acme.driveCount >= 1);
  assert.equal(acme.highestPackage, 800000);
});
