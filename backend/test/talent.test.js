import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

/**
 * The talent pool and the student directory — who may see whom.
 *
 * This file exists for one property, and it is the one a student would care
 * about most: **a company browsing sees no name, no email and no phone.** It
 * sees enough to judge a candidate and not enough to contact one, and the
 * contact details unlock only when that student applies to that company's
 * drive. Applying is how a student says "you may contact me", and it is the
 * only way that permission is ever given.
 *
 * The corollary is tested too: a company can never reach a student it has not
 * recruited, and one company's applicant does not unlock for another.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, "test-talent.sqlite");

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
  createUser,
  upsertActor,
  upsertProfile,
  setSkills,
  addResumeItem,
  upsertDrive,
  addApplication,
  setPlacement,
} = await import("../src/db.js");
const { parseSkills, parseResumeItem } = await import("../src/resume.js");
const { createApp } = await import("../src/app.js");
const { signToken } = await import("../src/auth.js");
const { ROLE, STATUS, DRIVE_STATUS } = await import("../src/chain.js");
const { default: request } = await import("supertest");

const app = createApp();

function authHeader(user) {
  return `Bearer ${signToken({
    userId: user.id,
    address: user.wallet_address,
    tokenVersion: user.token_version,
  })}`;
}

let college, acme, rival, asha, rahul, meera, outsider;

/** Creates a login plus its mirrored on-chain identity. */
function makeAccount({ email, role, status = STATUS.Active, name, collegeAddress = null }) {
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
    status,
    name,
    college: collegeAddress,
    registeredAtBlock: 1,
    updatedAtBlock: 1,
  });
  return user;
}

before(() => {
  college = makeAccount({
    email: "cell@college.test",
    role: ROLE.College,
    name: "Test Institute",
  });

  acme = makeAccount({ email: "hr@acme.test", role: ROLE.Company, name: "Acme Ltd" });
  rival = makeAccount({ email: "hr@rival.test", role: ROLE.Company, name: "Rival Ltd" });

  asha = makeAccount({
    email: "asha@college.test",
    role: ROLE.Student,
    name: "Asha Patil",
    collegeAddress: college.wallet_address,
  });
  rahul = makeAccount({
    email: "rahul@college.test",
    role: ROLE.Student,
    name: "Rahul Nair",
    collegeAddress: college.wallet_address,
  });
  meera = makeAccount({
    email: "meera@college.test",
    role: ROLE.Student,
    name: "Meera Rao",
    collegeAddress: college.wallet_address,
  });
  // Signed up, never verified: no on-chain identity at all.
  outsider = createUser({
    email: "outsider@nowhere.test",
    passwordHash: "hash",
    walletAddress: ethers.Wallet.createRandom().address,
    encryptedPrivateKey: "iv:tag:ct",
  });

  upsertProfile(asha.wallet_address, college.wallet_address, {
    roll_number: "21CE1041",
    full_name: "Asha Patil",
    course_code: "CSE",
    batch_year: 2026,
    cgpa_scaled: 880,
    phone: "9876543210",
    headline: "Backend and databases",
    github_url: "https://github.com/asha",
  });
  upsertProfile(rahul.wallet_address, college.wallet_address, {
    roll_number: "21CE1042",
    full_name: "Rahul Nair",
    course_code: "CSE",
    batch_year: 2026,
    cgpa_scaled: 650,
    phone: "9876500000",
  });
  upsertProfile(meera.wallet_address, college.wallet_address, {
    roll_number: "21ME2001",
    full_name: "Meera Rao",
    course_code: "MECH",
    batch_year: 2027,
    cgpa_scaled: 910,
  });

  setSkills(asha.wallet_address, parseSkills(["React.js", "PostgreSQL", "Python"]).values);
  setSkills(rahul.wallet_address, parseSkills(["Python"]).values);
  setSkills(meera.wallet_address, parseSkills(["AutoCAD"]).values);

  addResumeItem(
    asha.wallet_address,
    parseResumeItem("experience", {
      title: "Backend Intern",
      subtitle: "Acme Ltd",
      description: "Built the billing API.",
    }).values
  );

  // One drive from Acme, which Asha applies to. Rival posts nothing.
  upsertDrive({
    id: 1,
    companyAddress: acme.wallet_address,
    collegeAddress: college.wallet_address,
    roleTitle: "Software Engineer",
    annualPackage: 650000,
    minCgpaScaled: 700,
    batchYear: 2026,
    applicationDeadline: Math.floor(Date.now() / 1000) + 86400,
    driveDate: Math.floor(Date.now() / 1000) + 172800,
    ipfsHash: "QmTest",
    status: DRIVE_STATUS.Approved,
    postedAt: 1,
    blockNumber: 1,
  });
  addApplication(1, asha.wallet_address);

  setPlacement({
    studentAddress: meera.wallet_address,
    collegeAddress: college.wallet_address,
    batchYear: 2027,
    placed: true,
    blockNumber: 1,
  });
});

after(() => {
  db.close();
  cleanupDbFiles();
});

// --- the boundary ------------------------------------------------------------

test("browsing returns no name, email or phone anywhere in the response", async () => {
  const res = await request(app).get("/talent").set("Authorization", authHeader(acme));
  assert.equal(res.status, 200);
  assert.ok(res.body.students.length >= 3);

  // Asserted against the whole serialized body rather than field by field: a
  // new field added later would slip past a field-by-field check.
  const blob = JSON.stringify(res.body);
  assert.ok(!blob.includes("Asha Patil"), "a student's name leaked");
  assert.ok(!blob.includes("asha@college.test"), "a student's email leaked");
  assert.ok(!blob.includes("9876543210"), "a student's phone leaked");
});

test("browsing does return what a recruiter needs to judge", async () => {
  const res = await request(app).get("/talent").set("Authorization", authHeader(acme));
  const card = res.body.students.find((s) => s.rollNumber === "21CE1041");
  assert.equal(card.courseCode, "CSE");
  assert.equal(card.batchYear, 2026);
  assert.equal(card.cgpa, 8.8);
  assert.equal(card.headline, "Backend and databases");
  assert.deepEqual(card.skills.sort(), ["PostgreSQL", "Python", "React.js"]);
});

test("a student's full profile is still anonymous to a company that hasn't met them", async () => {
  const res = await request(app).get("/talent/21CE1042").set("Authorization", authHeader(acme));
  assert.equal(res.status, 200);
  assert.equal(res.body.student.contactUnlocked, false);
  assert.equal(res.body.student.contact, undefined);
  // And it says why, so a recruiter reads a rule rather than assuming the
  // profile is half-finished.
  assert.match(res.body.student.contactUnlockedBy, /applies to one of your drives/);
  assert.ok(!JSON.stringify(res.body).includes("Rahul Nair"));
});

test("applying to a company's drive unlocks that student's contact details", async () => {
  // The permission is the student's to give, and applying is how they give it.
  const res = await request(app).get("/talent/21CE1041").set("Authorization", authHeader(acme));
  assert.equal(res.body.student.contactUnlocked, true);
  assert.equal(res.body.student.contact.fullName, "Asha Patil");
  assert.equal(res.body.student.contact.email, "asha@college.test");
  assert.equal(res.body.student.contact.phone, "9876543210");
});

test("that unlock does not extend to a different company", async () => {
  // Rival posted no drive and Asha applied to nothing of theirs.
  const res = await request(app).get("/talent/21CE1041").set("Authorization", authHeader(rival));
  assert.equal(res.body.student.contactUnlocked, false);
  assert.ok(!JSON.stringify(res.body).includes("asha@college.test"));
});

test("a company browsing sees the resume, which is the point of it", async () => {
  const res = await request(app).get("/talent/21CE1041").set("Authorization", authHeader(acme));
  assert.equal(res.body.student.resume.experience[0].title, "Backend Intern");
  assert.equal(res.body.student.links.github, "https://github.com/asha");
});

// --- who may browse at all ---------------------------------------------------

test("a student cannot browse the talent pool", async () => {
  const res = await request(app).get("/talent").set("Authorization", authHeader(asha));
  assert.equal(res.status, 403);
});

test("the college cannot browse it either", async () => {
  // Not because it would be scandalous, but because the college already has its
  // own roster view — this route is the anonymised one, and having two ways to
  // read the same people is how one of them ends up forgotten in a refactor.
  const res = await request(app).get("/talent").set("Authorization", authHeader(college));
  assert.equal(res.status, 403);
});

test("an unapproved company cannot browse", async () => {
  const pending = makeAccount({
    email: "pending@corp.test",
    role: ROLE.Company,
    status: STATUS.Pending,
    name: "Pending Corp",
  });
  const res = await request(app).get("/talent").set("Authorization", authHeader(pending));
  assert.equal(res.status, 403);
});

test("a suspended company loses access immediately", async () => {
  const suspended = makeAccount({
    email: "suspended@corp.test",
    role: ROLE.Company,
    status: STATUS.Suspended,
    name: "Suspended Corp",
  });
  const res = await request(app).get("/talent").set("Authorization", authHeader(suspended));
  assert.equal(res.status, 403);
});

// --- filters -----------------------------------------------------------------

test("a CGPA filter excludes those below it", async () => {
  const res = await request(app)
    .get("/talent?minCgpa=7")
    .set("Authorization", authHeader(acme));
  const rolls = res.body.students.map((s) => s.rollNumber);
  assert.ok(rolls.includes("21CE1041"));
  assert.ok(!rolls.includes("21CE1042"), "a 6.50 should not clear a 7.00 filter");
});

test("two skills mean AND, not OR", async () => {
  // A recruiter listing React and PostgreSQL wants people with both.
  const res = await request(app)
    .get("/talent?skills=react.js,postgresql")
    .set("Authorization", authHeader(acme));
  assert.deepEqual(
    res.body.students.map((s) => s.rollNumber),
    ["21CE1041"]
  );
});

test("a filter spelling matches how the student typed it", async () => {
  const res = await request(app)
    .get("/talent?skills=REACT%20JS")
    .set("Authorization", authHeader(acme));
  assert.deepEqual(
    res.body.students.map((s) => s.rollNumber),
    ["21CE1041"]
  );
});

test("placed students can be filtered out, and are marked either way", async () => {
  const unplaced = await request(app)
    .get("/talent?placed=false")
    .set("Authorization", authHeader(acme));
  assert.ok(!unplaced.body.students.some((s) => s.rollNumber === "21ME2001"));

  const placed = await request(app).get("/talent?placed=true").set("Authorization", authHeader(acme));
  assert.deepEqual(
    placed.body.students.map((s) => s.rollNumber),
    ["21ME2001"]
  );
  assert.equal(placed.body.students[0].placed, true);
});

test("course and batch filters narrow the pool", async () => {
  const res = await request(app)
    .get("/talent?courseCode=MECH&batchYear=2027")
    .set("Authorization", authHeader(acme));
  assert.deepEqual(
    res.body.students.map((s) => s.rollNumber),
    ["21ME2001"]
  );
});

test("the filter options come from students who actually exist", async () => {
  const res = await request(app).get("/talent/facets").set("Authorization", authHeader(acme));
  assert.deepEqual(res.body.courses.map((c) => c.code).sort(), ["CSE", "MECH"]);
  assert.deepEqual(res.body.batches.map((b) => b.year), [2027, 2026]);
  assert.equal(res.body.skills.find((s) => s.skill === "python").students, 2);
});

test("a nonsense filter is refused rather than silently ignored", async () => {
  const res = await request(app).get("/talent?minCgpa=99").set("Authorization", authHeader(acme));
  assert.equal(res.status, 400);
});

// --- students looking each other up ------------------------------------------

test("a classmate is found with the roll number and the email together", async () => {
  const res = await request(app)
    .post("/students/lookup")
    .set("Authorization", authHeader(rahul))
    .send({ rollNumber: "21CE1041", email: "asha@college.test" });

  assert.equal(res.status, 200);
  assert.equal(res.body.student.fullName, "Asha Patil");
  assert.equal(res.body.student.resume.experience[0].title, "Backend Intern");
});

test("the right roll number with the wrong email finds nothing", async () => {
  const res = await request(app)
    .post("/students/lookup")
    .set("Authorization", authHeader(rahul))
    .send({ rollNumber: "21CE1041", email: "guess@college.test" });
  assert.equal(res.status, 404);
});

test("a miss and a wrong email answer identically", async () => {
  // Otherwise the difference between them would confirm which roll numbers
  // exist, which is the thing requiring the pair is meant to prevent.
  const wrongEmail = await request(app)
    .post("/students/lookup")
    .set("Authorization", authHeader(rahul))
    .send({ rollNumber: "21CE1041", email: "nope@college.test" });
  const noSuchRoll = await request(app)
    .post("/students/lookup")
    .set("Authorization", authHeader(rahul))
    .send({ rollNumber: "21CE9999", email: "nope@college.test" });

  assert.equal(wrongEmail.status, noSuchRoll.status);
  assert.equal(wrongEmail.body.error, noSuchRoll.body.error);
});

test("one of the two on its own is refused", async () => {
  const res = await request(app)
    .post("/students/lookup")
    .set("Authorization", authHeader(rahul))
    .send({ rollNumber: "21CE1041" });
  assert.equal(res.status, 400);
});

test("an unverified account cannot look anyone up", async () => {
  // Otherwise the roll-number check would be protecting nothing: anyone could
  // sign up with any email and read every profile in the college.
  const res = await request(app)
    .post("/students/lookup")
    .set("Authorization", authHeader(outsider))
    .send({ rollNumber: "21CE1041", email: "asha@college.test" });
  assert.equal(res.status, 403);
});

test("a company cannot use the student lookup to get around anonymity", async () => {
  const res = await request(app)
    .post("/students/lookup")
    .set("Authorization", authHeader(acme))
    .send({ rollNumber: "21CE1041", email: "asha@college.test" });
  assert.equal(res.status, 403);
});
