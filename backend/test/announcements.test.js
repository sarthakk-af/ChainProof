import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

/**
 * Placement notices — the only editable surface on the platform.
 *
 * Which is the whole reason this file is careful. Everything else here is a
 * chain record that nobody can revise; a notice is ordinary text that its
 * author can rewrite. So the properties worth holding are about authorship and
 * visibility rather than permanence:
 *
 *   - only the college and the companies it admitted may post, and a company
 *     only about its own drives;
 *   - an edit is stamped rather than silent, because a notice quietly rewritten
 *     after people acted on it is the one failure mode an editable feed has;
 *   - a withdrawal is a tombstone, so a notice that was published and pulled
 *     cannot be made to look like it never existed.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, "test-announcements.sqlite");

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

const { db, createUser, upsertActor, upsertDrive, getAnnouncement } = await import("../src/db.js");
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

let college, acme, rival, student;

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

before(() => {
  college = makeAccount({ email: "cell@college.test", role: ROLE.College, name: "Test Institute" });
  acme = makeAccount({ email: "hr@acme.test", role: ROLE.Company, name: "Acme Ltd" });
  rival = makeAccount({ email: "hr@rival.test", role: ROLE.Company, name: "Rival Ltd" });
  student = makeAccount({
    email: "asha@college.test",
    role: ROLE.Student,
    name: "Asha",
    collegeAddress: college.wallet_address,
  });

  const now = Math.floor(Date.now() / 1000);
  upsertDrive({
    id: 1,
    companyAddress: acme.wallet_address,
    collegeAddress: college.wallet_address,
    roleTitle: "Software Engineer",
    annualPackage: 650000,
    minCgpaScaled: 700,
    batchYear: 2026,
    applicationDeadline: now + 86400,
    driveDate: now + 172800,
    ipfsHash: "QmTest",
    status: DRIVE_STATUS.Approved,
    postedAt: 1,
    blockNumber: 1,
  });
});

after(() => {
  db.close();
  cleanupDbFiles();
});

// --- who may post ------------------------------------------------------------

test("the college can post a notice", async () => {
  const res = await request(app)
    .post("/announcements")
    .set("Authorization", authHeader(college))
    .send({ title: "Pre-placement talk moved", body: "Now in Hall B at 10am." });

  assert.equal(res.status, 201);
  assert.equal(res.body.announcement.authorName, "Test Institute");
  assert.equal(res.body.announcement.audience, "students");
  assert.equal(res.body.announcement.editedAt, null);
});

test("a company can post about its own drive", async () => {
  const res = await request(app)
    .post("/announcements")
    .set("Authorization", authHeader(acme))
    .send({ driveId: 1, title: "Bring two CV copies", body: "And a photo ID." });

  assert.equal(res.status, 201);
  assert.equal(res.body.announcement.driveId, 1);
  assert.equal(res.body.announcement.driveRoleTitle, "Software Engineer");
});

test("a company cannot post about someone else's drive", async () => {
  const res = await request(app)
    .post("/announcements")
    .set("Authorization", authHeader(rival))
    .send({ driveId: 1, title: "Actually we cancelled this", body: "Ignore Acme." });

  assert.equal(res.status, 403);
  assert.match(res.body.error, /your own drives/);
});

test("a company must name a drive at all", async () => {
  // Otherwise a notice becomes a channel for a company to say whatever it likes
  // about a college it has no relationship with.
  const res = await request(app)
    .post("/announcements")
    .set("Authorization", authHeader(acme))
    .send({ title: "General thoughts", body: "About the industry." });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /which of your drives/);
});

test("a student cannot post", async () => {
  const res = await request(app)
    .post("/announcements")
    .set("Authorization", authHeader(student))
    .send({ title: "Anyone free", body: "for a study group?" });
  assert.equal(res.status, 403);
});

test("an empty notice is refused", async () => {
  const noTitle = await request(app)
    .post("/announcements")
    .set("Authorization", authHeader(college))
    .send({ body: "..." });
  assert.equal(noTitle.status, 400);

  const noBody = await request(app)
    .post("/announcements")
    .set("Authorization", authHeader(college))
    .send({ title: "Something" });
  assert.equal(noBody.status, 400);
});

// --- editing -----------------------------------------------------------------

test("an edit is stamped, never silent", async () => {
  const created = await request(app)
    .post("/announcements")
    .set("Authorization", authHeader(college))
    .send({ title: "Interview at 10am", body: "Report to the main gate." });
  const { id } = created.body.announcement;

  const edited = await request(app)
    .patch(`/announcements/${id}`)
    .set("Authorization", authHeader(college))
    .send({ title: "Interview at 2pm", body: "Report to the main gate." });

  assert.equal(edited.status, 200);
  assert.equal(edited.body.announcement.title, "Interview at 2pm");
  // The point: anyone reading it can see it was changed after publishing.
  assert.ok(edited.body.announcement.editedAt, "the edit should be stamped");
});

test("only the author can edit", async () => {
  const created = await request(app)
    .post("/announcements")
    .set("Authorization", authHeader(acme))
    .send({ driveId: 1, title: "Our slot", body: "Room 4." });
  const { id } = created.body.announcement;

  const hostile = await request(app)
    .patch(`/announcements/${id}`)
    .set("Authorization", authHeader(rival))
    .send({ title: "Cancelled", body: "Do not attend." });

  assert.equal(hostile.status, 404);
  assert.equal(getAnnouncement(id).title, "Our slot");
});

test("even the college cannot rewrite a company's notice", async () => {
  // The college hosts the drive; it does not speak for the company. Same
  // division as everywhere else here.
  const created = await request(app)
    .post("/announcements")
    .set("Authorization", authHeader(acme))
    .send({ driveId: 1, title: "Our package", body: "6.5 LPA as advertised." });
  const { id } = created.body.announcement;

  const res = await request(app)
    .patch(`/announcements/${id}`)
    .set("Authorization", authHeader(college))
    .send({ title: "Our package", body: "8 LPA." });
  assert.equal(res.status, 404);
});

// --- withdrawing -------------------------------------------------------------

test("withdrawing hides a notice but leaves the row behind", async () => {
  const created = await request(app)
    .post("/announcements")
    .set("Authorization", authHeader(college))
    .send({ title: "Scheduled maintenance", body: "Ignore this." });
  const { id } = created.body.announcement;

  const deleted = await request(app)
    .delete(`/announcements/${id}`)
    .set("Authorization", authHeader(college));
  assert.equal(deleted.status, 200);

  const feed = await request(app).get("/announcements").set("Authorization", authHeader(student));
  assert.ok(!feed.body.announcements.some((a) => a.id === id));

  // A tombstone, not a DELETE: a notice that was published and pulled cannot be
  // made to look like it never existed.
  const row = getAnnouncement(id);
  assert.ok(row, "the row should still exist");
  assert.ok(row.deleted_at, "it should be marked withdrawn");
});

test("a withdrawn notice cannot be withdrawn or edited again", async () => {
  const created = await request(app)
    .post("/announcements")
    .set("Authorization", authHeader(college))
    .send({ title: "Temporary", body: "Gone shortly." });
  const { id } = created.body.announcement;
  await request(app).delete(`/announcements/${id}`).set("Authorization", authHeader(college));

  const again = await request(app)
    .delete(`/announcements/${id}`)
    .set("Authorization", authHeader(college));
  assert.equal(again.status, 404);

  const edit = await request(app)
    .patch(`/announcements/${id}`)
    .set("Authorization", authHeader(college))
    .send({ title: "Back again", body: "Not really." });
  assert.equal(edit.status, 404);
});

// --- audience ----------------------------------------------------------------

test("a public notice reaches the parent-facing page; a student one does not", async () => {
  await request(app)
    .post("/announcements")
    .set("Authorization", authHeader(college))
    .send({
      title: "Placement season opens",
      body: "Twelve companies confirmed.",
      audience: "public",
    });
  await request(app)
    .post("/announcements")
    .set("Authorization", authHeader(college))
    .send({ title: "Room change", body: "Hall B.", audience: "students" });

  const publicFeed = await request(app).get(
    `/public/colleges/${college.wallet_address}/announcements`
  );
  assert.equal(publicFeed.status, 200);
  const titles = publicFeed.body.announcements.map((a) => a.title);
  assert.ok(titles.includes("Placement season opens"));
  assert.ok(
    !titles.includes("Room change"),
    "an operational notice should not clutter the parent-facing page"
  );
});

test("a student sees the college's whole feed", async () => {
  const res = await request(app).get("/announcements").set("Authorization", authHeader(student));
  assert.equal(res.status, 200);
  const titles = res.body.announcements.map((a) => a.title);
  assert.ok(titles.includes("Room change"));
  assert.ok(titles.includes("Bring two CV copies"));
});

test("a company can list just its own notices", async () => {
  const res = await request(app)
    .get("/announcements?mine=true")
    .set("Authorization", authHeader(acme));
  assert.ok(res.body.announcements.length > 0);
  assert.ok(res.body.announcements.every((a) => a.authorName === "Acme Ltd"));
});
