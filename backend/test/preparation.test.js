import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

/**
 * The preparation record — the college's own evidence of effort.
 *
 * Every other figure on the public page holds the college to account for
 * results. This is the one place it is the author rather than the subject, and
 * that asymmetry is only defensible because of two things this file checks:
 *
 *   - a cancelled event stays visible and stops counting. Otherwise a college
 *     could record ten sessions, call off nine, and still show ten;
 *   - the block timestamp is kept alongside the claimed date. A log written as
 *     the year went is a different statement from one assembled in June, and
 *     only that pair of dates can tell them apart.
 *
 * The on-chain half is covered by test/PreparationLog.test.js and the live
 * journey suite; this is the mirror and the arithmetic read off it.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, "test-preparation.sqlite");

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
process.env.JWT_SECRET = "test-jwt-secret";
process.env.WALLET_ENCRYPTION_KEY =
  "236d277256c4ac74368580b5be214189ace6dff26eb4e5efe448dbf1c2a1158c";
process.env.DB_PATH = TEST_DB_PATH;

const {
  db,
  upsertActor,
  EVENT_KIND,
  EVENT_KIND_LABELS,
  upsertPreparationEvent,
  setPreparationCancelled,
  getPreparationEvent,
  listPreparationEvents,
  preparationSummary,
} = await import("../src/db.js");
const { ROLE, STATUS } = await import("../src/chain.js");
const { serializePreparationEvent } = await import("../src/serializers.js");

const college = ethers.Wallet.createRandom().address.toLowerCase();
const other = ethers.Wallet.createRandom().address.toLowerCase();

const DAY = 24 * 60 * 60;
const HELD = Math.floor(Date.now() / 1000) - 30 * DAY;

function record(id, overrides = {}) {
  upsertPreparationEvent({
    id,
    collegeAddress: college,
    kind: EVENT_KIND.Training,
    title: `Session ${id}`,
    conductedBy: "Placement Cell",
    heldOn: HELD,
    attendance: 100,
    batchYear: 2026,
    ipfsHash: null,
    recordedAt: HELD + 3600,
    blockNumber: 10 + id,
    ...overrides,
  });
}

before(() => {
  upsertActor({
    address: college,
    role: ROLE.College,
    status: STATUS.Active,
    name: "Test Institute",
    college: null,
    registeredAtBlock: 1,
    updatedAtBlock: 1,
  });
});

after(() => {
  db.close();
  cleanupDbFiles();
});

test("an event from the chain is mirrored whole", () => {
  record(1, { title: "Aptitude Series 3", attendance: 142 });
  const row = getPreparationEvent(1);
  assert.equal(row.title, "Aptitude Series 3");
  assert.equal(row.conducted_by, "Placement Cell");
  assert.equal(row.attendance, 142);
  assert.equal(row.cancelled, 0);
});

test("the same log arriving twice does not duplicate it", () => {
  // The indexer re-reads overlapping ranges after a gap or a restart, so this
  // happens routinely. The id comes from the contract, so a second arrival is
  // always the same event — never a new one.
  record(1, { title: "Should not overwrite" });
  assert.equal(getPreparationEvent(1).title, "Aptitude Series 3");
  assert.equal(listPreparationEvents(college).length, 1);
});

test("cancelling keeps the entry and its original claim", () => {
  record(2, { title: "Mock Interviews", kind: EVENT_KIND.MockInterview, attendance: 60 });
  setPreparationCancelled(2, "Trainer unavailable", 99);

  const row = getPreparationEvent(2);
  assert.equal(row.cancelled, 1);
  assert.equal(row.cancel_reason, "Trainer unavailable");
  // Nothing about what was originally claimed is erased.
  assert.equal(row.title, "Mock Interviews");
  assert.equal(row.attendance, 60);
});

test("cancelled events still appear in the list", () => {
  // Hiding them would let a college record ten sessions, call off nine, and
  // still look busy.
  const rows = listPreparationEvents(college);
  assert.ok(rows.some((r) => r.id === 2 && r.cancelled === 1));
});

test("a cancelled event stops counting towards the standing total", () => {
  const summary = preparationSummary(college);
  assert.equal(summary.standing, 1);
  assert.equal(summary.cancelled, 1);
  // And its attendance stops counting too, or the figure would still credit a
  // session nobody attended.
  assert.equal(summary.attendances, 142);
});

test("the summary breaks down by kind", () => {
  record(3, { kind: EVENT_KIND.Workshop, title: "Resume Clinic", attendance: 40 });
  record(4, { kind: EVENT_KIND.Seminar, title: "Alumni Talk", attendance: 200 });

  const summary = preparationSummary(college);
  const byKind = Object.fromEntries(summary.byKind.map((k) => [k.kind, k]));
  assert.equal(byKind.Training.standing, 1);
  assert.equal(byKind["Mock interview"].standing, 0);
  assert.equal(byKind["Mock interview"].cancelled, 1);
  assert.equal(byKind.Workshop.attendance, 40);
  assert.equal(summary.standing, 3);
});

test("a cohort's view includes events open to everyone", () => {
  // An event aimed at all students is still preparation that cohort received;
  // excluding it would make their record look emptier than it was.
  record(5, { batchYear: 0, title: "Open to all", attendance: 300 });
  record(6, { batchYear: 2027, title: "Junior batch only", attendance: 50 });

  const forBatch = listPreparationEvents(college, { batchYear: 2026 }).map((r) => r.title);
  assert.ok(forBatch.includes("Open to all"));
  assert.ok(!forBatch.includes("Junior batch only"));
});

test("one college's record never appears under another", () => {
  upsertPreparationEvent({
    id: 99,
    collegeAddress: other,
    kind: EVENT_KIND.Training,
    title: "Not ours",
    conductedBy: "Someone else",
    heldOn: HELD,
    attendance: 10,
    batchYear: 2026,
    ipfsHash: null,
    recordedAt: HELD,
    blockNumber: 1,
  });
  assert.ok(!listPreparationEvents(college).some((r) => r.title === "Not ours"));
  assert.equal(preparationSummary(other).standing, 1);
});

test("the serialized event publishes when it was recorded, not only when it was held", () => {
  const out = serializePreparationEvent(getPreparationEvent(1), EVENT_KIND_LABELS);
  assert.equal(out.kind, "Training");
  assert.equal(out.heldOn, HELD);
  // The honest field: the claimed date is the college's word, this one is not.
  assert.equal(out.recordedAt, HELD + 3600);
});

test("events are listed most recent first", () => {
  record(7, { heldOn: HELD + 10 * DAY, title: "Most recent" });
  assert.equal(listPreparationEvents(college)[0].title, "Most recent");
});
