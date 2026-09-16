import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

/**
 * The roster is how the platform answers "does this person actually study here?".
 *
 * Nothing else admits a student: a roll number that isn't on the college's own
 * list cannot be invented, and one already taken cannot be claimed twice. If
 * either of those gave way, a student's identity would be back to whatever they
 * typed into a form — and every figure derived from it would mean nothing.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, "test-roster.sqlite");

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

const {
  db,
  upsertRosterEntries,
  getRosterEntry,
  claimRosterEntry,
  releaseRosterClaim,
  getRosterEntryForAddress,
  listRoster,
  rosterCounts,
} = await import("../src/db.js");

const college = ethers.Wallet.createRandom().address;
const otherCollege = ethers.Wallet.createRandom().address;

function entry(roll, name = "A Student", course = "CSE", year = 2026) {
  return { roll_number: roll, full_name: name, course_code: course, batch_year: year };
}

before(() => {
  upsertRosterEntries(college, [
    entry("21CE1041", "Asha Patil"),
    entry("21CE1042", "Rahul Nair"),
    entry("21ME2001", "Sara Khan", "MECH"),
  ]);
});

after(() => {
  db.close();
  cleanupDbFiles();
});

test("rows are stored and read back per college", () => {
  const row = getRosterEntry(college, "21CE1041");
  assert.equal(row.full_name, "Asha Patil");
  assert.equal(row.course_code, "CSE");
  assert.equal(row.claimed_by, null);
  assert.equal(listRoster(college).length, 3);
});

test("a roll number is scoped to its college", () => {
  // The same roll number at two institutions is entirely normal, and one
  // college's list must never admit a student to another's.
  upsertRosterEntries(otherCollege, [entry("21CE1041", "Someone Else")]);
  assert.equal(getRosterEntry(college, "21CE1041").full_name, "Asha Patil");
  assert.equal(getRosterEntry(otherCollege, "21CE1041").full_name, "Someone Else");
});

test("an unknown roll number simply isn't there", () => {
  assert.equal(getRosterEntry(college, "21CE9999"), undefined);
});

test("claiming a row succeeds once and only once", () => {
  const first = ethers.Wallet.createRandom().address;
  const second = ethers.Wallet.createRandom().address;

  assert.equal(claimRosterEntry(college, "21CE1042", first), true);
  // The second caller loses. The condition lives inside the UPDATE, so two
  // simultaneous signups can't both pass a read-then-write check the way the
  // registration, approval and correction races all did.
  assert.equal(claimRosterEntry(college, "21CE1042", second), false);

  assert.equal(getRosterEntry(college, "21CE1042").claimed_by.toLowerCase(), first.toLowerCase());
});

test("a claim is found by the address that holds it, whatever the casing", () => {
  const address = ethers.Wallet.createRandom().address; // checksummed, mixed case
  claimRosterEntry(college, "21ME2001", address);

  assert.equal(getRosterEntryForAddress(address)?.roll_number, "21ME2001");
  assert.equal(getRosterEntryForAddress(address.toLowerCase())?.roll_number, "21ME2001");
});

test("releasing a claim frees the row for someone else", () => {
  const address = ethers.Wallet.createRandom().address;
  upsertRosterEntries(college, [entry("21CE1050", "Temp Student")]);
  assert.equal(claimRosterEntry(college, "21CE1050", address), true);

  // A registration that fails partway must not lock a roll number away from the
  // person it actually belongs to.
  releaseRosterClaim(address.toLowerCase());
  assert.equal(getRosterEntry(college, "21CE1050").claimed_by, null);
  assert.equal(claimRosterEntry(college, "21CE1050", ethers.Wallet.createRandom().address), true);
});

test("re-uploading updates an unclaimed row", () => {
  upsertRosterEntries(college, [entry("21CE1060", "Wrong Name")]);
  const result = upsertRosterEntries(college, [entry("21CE1060", "Correct Name")]);

  assert.equal(result.updated, 1);
  assert.equal(result.added, 0);
  assert.equal(getRosterEntry(college, "21CE1060").full_name, "Correct Name");
});

test("re-uploading leaves a CLAIMED row alone, and says so", () => {
  // Someone is already using this row. Rewriting the name or course under them
  // would silently change who their account says they are.
  const address = ethers.Wallet.createRandom().address;
  upsertRosterEntries(college, [entry("21CE1070", "Original Name")]);
  claimRosterEntry(college, "21CE1070", address);

  const result = upsertRosterEntries(college, [entry("21CE1070", "Overwritten Name")]);
  assert.deepEqual(result.skipped, ["21CE1070"]);
  assert.equal(getRosterEntry(college, "21CE1070").full_name, "Original Name");
});

test("counts report listed against claimed, per cohort", () => {
  // The gap between these is the opt-in rate — how many the college listed
  // versus how many actually signed up — which is worth publishing next to a
  // placement percentage rather than leaving implicit.
  const counts = rosterCounts(college);
  const cse2026 = counts.find((c) => c.course_code === "CSE" && c.batch_year === 2026);
  assert.ok(cse2026.listed >= 2);
  assert.ok(cse2026.claimed >= 1);
  assert.ok(cse2026.claimed <= cse2026.listed);
});

test("listing can be filtered to one cohort", () => {
  upsertRosterEntries(college, [entry("21CE3001", "Next Batch", "CSE", 2027)]);
  const only2027 = listRoster(college, { batchYear: 2027 });
  assert.ok(only2027.every((r) => r.batch_year === 2027));
  assert.ok(only2027.some((r) => r.roll_number === "21CE3001"));
});
