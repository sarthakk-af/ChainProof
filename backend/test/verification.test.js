import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

/**
 * Student verification — the part that used to be a dead end.
 *
 * The rule these tests protect: **nobody may reach a state with no way
 * forward.** Previously a student could not register without a roll number,
 * could not have a roll number without a roster, and had no recourse if the
 * roster was not up yet. Both orderings now work, and the checks below are the
 * ones that would have caught the original wall.
 *
 * The second rule, which must survive all of that softening: unverified means
 * look, don't touch. The moment an unverified account can act, the roll-number
 * check stops being worth having.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, "test-verification.sqlite");

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
  createUser,
  setEmailVerified,
  upsertActor,
  upsertRosterEntries,
  getRosterEntry,
  releaseRosterClaimByRoll,
  getVerification,
  listPendingVerifications,
  VERIFICATION,
} = await import("../src/db.js");
const { claimRollNumber, verificationState, rejectQueuedStudent } = await import(
  "../src/studentVerification.js"
);
const { getUserById } = await import("../src/db.js");
const { ROLE, STATUS } = await import("../src/chain.js");

const college = ethers.Wallet.createRandom().address;
let seq = 0;

function makeUser({ emailVerified = false, email } = {}) {
  const user = createUser({
    email: email ?? `verify-${seq++}@example.com`,
    passwordHash: "hash",
    walletAddress: ethers.Wallet.createRandom().address,
    encryptedPrivateKey: "iv:tag:ct",
  });
  if (emailVerified) setEmailVerified(user.id);
  return getUserById(user.id);
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
  upsertRosterEntries(college, [
    // With the college email, so this row admits exactly one account.
    {
      roll_number: "21CE1041",
      full_name: "Asha Patil",
      course_code: "CSE",
      batch_year: 2026,
      email: "asha.patil@somaiya.edu",
    },
    // Without one — the shape of an older roster, and of a college that only
    // uploads names. Nobody is auto-verified against it.
    { roll_number: "21CE1042", full_name: "Rahul Nair", course_code: "CSE", batch_year: 2026 },
  ]);
});

after(() => {
  db.close();
  cleanupDbFiles();
});

// --- a fresh account knows what it's missing ---------------------------------

test("a brand-new account is unverified and says why", () => {
  const user = makeUser();
  const state = verificationState(user);

  assert.equal(state.verified, false);
  assert.equal(state.emailVerified, false);
  // The interface needs this to name the next action instead of showing a
  // disabled button with no explanation.
  assert.deepEqual(state.missing.sort(), ["email", "rollNumber"]);
});

test("confirming the email alone does not verify the account", () => {
  const user = makeUser({ emailVerified: true });
  const state = verificationState(user);
  assert.equal(state.verified, false);
  assert.deepEqual(state.missing, ["rollNumber"]);
});

// --- ordering one: roster first ----------------------------------------------

test("a roster row is matched immediately for the email it belongs to", async () => {
  const user = makeUser({ emailVerified: true, email: "asha.patil@somaiya.edu" });
  const result = await claimRollNumber({
    userId: user.id,
    collegeAddress: college,
    rollNumber: "21CE1041",
  });

  assert.equal(result.matched, true);
  assert.equal(getVerification(user.id).status, VERIFICATION.Verified);
  // The roster row is now spoken for, which is what stops a second person
  // claiming it.
  assert.equal(
    getRosterEntry(college, "21CE1041").claimed_by.toLowerCase(),
    user.wallet_address.toLowerCase()
  );
});

test("a roll number already claimed by someone else is refused", async () => {
  const user = makeUser({ emailVerified: true, email: "someone.else@somaiya.edu" });
  const result = await claimRollNumber({
    userId: user.id,
    collegeAddress: college,
    rollNumber: "21CE1041",
  });
  assert.ok(result.error);
  assert.match(result.error, /already been claimed/i);
});

// --- the takeover this replaced ----------------------------------------------

test("somebody else's roll number is queued, not granted, and stays unclaimed", async () => {
  // The whole attack: roll numbers run in sequence, so a classmate's is a
  // guess away. It used to verify the guesser as that student, copy the real
  // student's name onto their account, and leave no way back.
  const attacker = makeUser({ emailVerified: true, email: "attacker@somaiya.edu" });
  const result = await claimRollNumber({
    userId: attacker.id,
    collegeAddress: college,
    rollNumber: "21CE1042",
  });

  assert.equal(result.matched, false);
  assert.equal(result.queued, true);
  assert.equal(getVerification(attacker.id).status, VERIFICATION.Pending);
  // Crucially the row is still free, so the real student is not locked out.
  assert.equal(getRosterEntry(college, "21CE1042").claimed_by, null);
});

test("the placement cell can free a roll number claimed by the wrong account", async () => {
  const wrong = makeUser({ emailVerified: true, email: "wrong@somaiya.edu" });
  upsertRosterEntries(college, [
    {
      roll_number: "21CE1050",
      full_name: "Meera Iyer",
      course_code: "CSE",
      batch_year: 2026,
      email: "wrong@somaiya.edu",
    },
  ]);
  await claimRollNumber({ userId: wrong.id, collegeAddress: college, rollNumber: "21CE1050" });
  assert.ok(getRosterEntry(college, "21CE1050").claimed_by);

  const released = releaseRosterClaimByRoll(college, "21CE1050");
  assert.equal(released.toLowerCase(), wrong.wallet_address.toLowerCase());
  assert.equal(getRosterEntry(college, "21CE1050").claimed_by, null);
  // Releasing a row nobody holds is not an error, it just reports nothing.
  assert.equal(releaseRosterClaimByRoll(college, "21CE1050"), null);
});

test("an upload that omits the email keeps the one already stored", () => {
  upsertRosterEntries(college, [
    {
      roll_number: "21CE1060",
      full_name: "Karan Shah",
      course_code: "CSE",
      batch_year: 2026,
      email: "karan.shah@somaiya.edu",
    },
  ]);
  // A college re-uploading an older file must not silently un-protect the row.
  upsertRosterEntries(college, [
    { roll_number: "21CE1060", full_name: "Karan Shah", course_code: "IT", batch_year: 2026 },
  ]);
  const row = getRosterEntry(college, "21CE1060");
  assert.equal(row.email, "karan.shah@somaiya.edu");
  assert.equal(row.course_code, "IT");
});

// --- ordering two: student first ---------------------------------------------

test("a roll number NOT on the roster queues instead of refusing", async () => {
  // The exact case the first build had no answer to. A student who signs up
  // before the roster is uploaded must not be told no.
  const user = makeUser({ emailVerified: true });
  const result = await claimRollNumber({
    userId: user.id,
    collegeAddress: college,
    rollNumber: "21CE9099",
  });

  assert.equal(result.queued, true);
  assert.ok(!result.error, "queuing is not an error");
  assert.equal(getVerification(user.id).status, VERIFICATION.Pending);

  const state = verificationState(getUserById(user.id));
  assert.equal(state.verified, false);
  assert.deepEqual(state.missing, ["collegeApproval"]);
  assert.equal(state.rollNumber, "21CE9099");
});

test("a queued student appears in the college's queue", () => {
  const pending = listPendingVerifications(college);
  assert.ok(pending.some((p) => p.roll_number === "21CE9099"));
  // The cell needs an address to reach them by.
  assert.ok(pending.every((p) => p.email));
});

test("two people cannot queue for the same roll number", async () => {
  const other = makeUser({ emailVerified: true });
  const result = await claimRollNumber({
    userId: other.id,
    collegeAddress: college,
    rollNumber: "21CE9099",
  });
  // Otherwise the cell would approve both before noticing.
  assert.ok(result.error);
  assert.match(result.error, /already requested/i);
});

test("a declined request says so, and can be retried", async () => {
  const user = makeUser({ emailVerified: true, email: "retry@somaiya.edu" });
  await claimRollNumber({ userId: user.id, collegeAddress: college, rollNumber: "21CE8080" });

  rejectQueuedStudent({ userId: user.id, collegeAddress: college, reason: "Not on our records." });

  const state = verificationState(getUserById(user.id));
  assert.equal(state.requestStatus, "Rejected");
  assert.equal(state.rejectionReason, "Not on our records.");

  // Rejection is not a dead end either — they can correct it and try again.
  upsertRosterEntries(college, [
    {
      roll_number: "21CE8081",
      full_name: "Retry Student",
      course_code: "CSE",
      batch_year: 2026,
      email: "retry@somaiya.edu",
    },
  ]);
  const retry = await claimRollNumber({
    userId: user.id,
    collegeAddress: college,
    rollNumber: "21CE8081",
  });
  assert.equal(retry.matched, true);
});

// --- guards ------------------------------------------------------------------

test("a malformed roll number is refused with the reason", async () => {
  const user = makeUser({ emailVerified: true });
  const result = await claimRollNumber({
    userId: user.id,
    collegeAddress: college,
    rollNumber: "bad!!",
  });
  assert.ok(result.error);
  assert.match(result.error, /Roll number/);
});

test("an unknown college is refused", async () => {
  const user = makeUser({ emailVerified: true });
  const result = await claimRollNumber({
    userId: user.id,
    collegeAddress: ethers.Wallet.createRandom().address,
    rollNumber: "21CE1042",
  });
  assert.ok(result.error);
  assert.match(result.error, /isn't set up/i);
});

test("an unverified email holds the on-chain write back", async () => {
  // Matching a roster row is not enough on its own. The address still has to be
  // proved before anything about this student counts — it just isn't a wall at
  // the front door any more.
  const user = makeUser({ emailVerified: false, email: "later@somaiya.edu" });
  upsertRosterEntries(college, [
    {
      roll_number: "21CE7070",
      full_name: "Later Email",
      course_code: "CSE",
      batch_year: 2026,
      email: "later@somaiya.edu",
    },
  ]);

  const result = await claimRollNumber({
    userId: user.id,
    collegeAddress: college,
    rollNumber: "21CE7070",
  });
  assert.equal(result.matched, true);
  assert.equal(result.completed, false);
  assert.equal(result.reason, "awaiting-email");

  const state = verificationState(getUserById(user.id));
  assert.equal(state.verified, false);
  assert.deepEqual(state.missing, ["email"]);
});
