import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

/**
 * Deleting an account — what goes, what stays, and who may.
 *
 * Personal data held off-chain is erasable; chain records are not, and are left
 * tied only to an address nothing links back to the person.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, "test-erasure.sqlite");

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
  getUserById,
  upsertActor,
  upsertProfile,
  upsertRosterEntries,
  claimRosterEntry,
  upsertVerification,
  setSkills,
  addResumeItem,
  upsertDrive,
  addApplication,
  addOutcome,
  VERIFICATION,
} = await import("../src/db.js");
const { parseSkills, parseResumeItem } = await import("../src/resume.js");
const { hashPassword, signToken } = await import("../src/auth.js");
const { createApp } = await import("../src/app.js");
const { ROLE, STATUS, DRIVE_STATUS, STAGE } = await import("../src/chain.js");
const { default: request } = await import("supertest");

const app = createApp();
const PASSWORD = "Password123";

function authHeader(user) {
  return `Bearer ${signToken({ userId: user.id, address: user.wallet_address, tokenVersion: user.token_version })}`;
}

async function makeAccount({ email, role, collegeAddress = null }) {
  const address = ethers.Wallet.createRandom().address;
  const user = createUser({
    email,
    passwordHash: await hashPassword(PASSWORD),
    walletAddress: address,
    encryptedPrivateKey: "iv:tag:ct",
  });
  upsertActor({ address, role, status: STATUS.Active, name: "Name", college: collegeAddress, registeredAtBlock: 1, updatedAtBlock: 1 });
  return user;
}

let college, company, student;
const count = (sql, ...args) => db.prepare(sql).get(...args).c;

before(async () => {
  college = await makeAccount({ email: "cell@college.test", role: ROLE.College });
  db.prepare("UPDATE users SET is_college_login = 1 WHERE id = ?").run(college.id);
  company = await makeAccount({ email: "hr@acme.test", role: ROLE.Company });
  student = await makeAccount({
    email: "asha@college.test",
    role: ROLE.Student,
    collegeAddress: college.wallet_address,
  });
  const addr = student.wallet_address;

  upsertRosterEntries(college.wallet_address, [
    { roll_number: "21CE1041", full_name: "Asha Patil", course_code: "CSE", batch_year: 2026, email: "asha@college.test" },
  ]);
  claimRosterEntry(college.wallet_address, "21CE1041", addr);
  upsertVerification({ userId: student.id, address: addr, collegeAddress: college.wallet_address, rollNumber: "21CE1041", status: VERIFICATION.Verified });
  upsertProfile(addr, college.wallet_address, { roll_number: "21CE1041", full_name: "Asha Patil", course_code: "CSE", batch_year: 2026, phone: "9876543210" });
  setSkills(addr, parseSkills(["Python"]).values);
  addResumeItem(addr, parseResumeItem("project", { title: "Billing API" }).values);

  upsertDrive({
    id: 1, companyAddress: company.wallet_address, collegeAddress: college.wallet_address,
    roleTitle: "SDE", annualPackage: 650000, minCgpaScaled: 0, batchYear: 2026,
    applicationDeadline: 1900000000, driveDate: 1900100000, ipfsHash: "QmTest",
    status: DRIVE_STATUS.Approved, postedAt: 1, blockNumber: 1,
  });
  addApplication(1, addr);
  addOutcome({ driveId: 1, studentAddress: addr, stage: STAGE.Shortlisted, previousStage: STAGE.None, label: null, ipfsHash: null, timestamp: 1, blockNumber: 2 });
});

after(() => {
  db.close();
  cleanupDbFiles();
});

test("deleting needs the password, not just an open session", async () => {
  const res = await request(app)
    .post("/auth/delete-account")
    .set("Authorization", authHeader(student))
    .send({ password: "WrongPassword1" });
  assert.equal(res.status, 403);
  assert.ok(getUserById(student.id), "a wrong password deleted the account");
});

test("the placement cell's login can't be deleted this way", async () => {
  const res = await request(app)
    .post("/auth/delete-account")
    .set("Authorization", authHeader(college))
    .send({ password: PASSWORD });
  assert.equal(res.status, 409);
  assert.ok(getUserById(college.id));
});

test("deleting erases everything personal held off-chain", async () => {
  const addr = student.wallet_address.toLowerCase();
  const res = await request(app)
    .post("/auth/delete-account")
    .set("Authorization", authHeader(student))
    .send({ password: PASSWORD });
  assert.equal(res.status, 200);

  assert.equal(getUserById(student.id), undefined);
  assert.equal(count("SELECT COUNT(*) c FROM users WHERE email = ?", "asha@college.test"), 0);
  assert.equal(count("SELECT COUNT(*) c FROM student_profiles WHERE address = ?", addr), 0);
  assert.equal(count("SELECT COUNT(*) c FROM student_resume_items WHERE address = ?", addr), 0);
  assert.equal(count("SELECT COUNT(*) c FROM student_skills WHERE address = ?", addr), 0);
  assert.equal(count("SELECT COUNT(*) c FROM applications WHERE student_address = ?", addr), 0);
  assert.equal(count("SELECT COUNT(*) c FROM student_verifications WHERE user_id = ?", student.id), 0);
});

test("the college's roster row stays, released for whoever claims it next", () => {
  const row = db.prepare("SELECT * FROM roster_entries WHERE roll_number = '21CE1041'").get();
  assert.equal(row.full_name, "Asha Patil");
  assert.equal(row.claimed_by, null);
});

test("chain records stay, tied only to the bare address", () => {
  const addr = student.wallet_address.toLowerCase();
  assert.equal(count("SELECT COUNT(*) c FROM drive_outcomes WHERE student_address = ?", addr), 1);
  assert.equal(count("SELECT COUNT(*) c FROM actors WHERE address = ?", addr), 1);
});

test("the deleted account's session no longer works", async () => {
  const res = await request(app).get("/me").set("Authorization", authHeader(student));
  assert.equal(res.status, 401);
});
