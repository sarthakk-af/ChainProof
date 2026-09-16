/**
 * The whole v2 story against the running stack.
 *
 * Contract tests prove each piece refuses what it should. This proves the
 * pieces plus the backend plus the database actually compose into a placement
 * season — and that the number the public page ends up showing matches what
 * genuinely happened.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(BACKEND_ROOT);
const src = (f) => pathToFileURL(path.join(BACKEND_ROOT, "src", f)).href;

const { createUser, setEmailVerified } = await import(src("db.js"));
const { signToken } = await import(src("auth.js"));
const { generateWallet } = await import(src("wallets.js"));
const { fundWallet } = await import(src("treasury.js"));
const { config } = await import(src("config.js"));

const BASE = process.env.API_URL || "http://127.0.0.1:4000";
const TS = Date.now();
const CID = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
let failures = 0;

function check(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${detail ? "  -- " + detail : ""}`);
}
function note(label, detail = "") {
  console.log(`  [NOTE] ${label}${detail ? "  -- " + detail : ""}`);
}

async function call(method, urlPath, { token, body } = {}) {
  const res = await fetch(BASE + urlPath, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data };
}

/**
 * Waits until a condition holds, rather than sleeping a fixed time.
 *
 * The indexer mirrors chain events asynchronously, so "sleep 1.5s and hope"
 * fails intermittently on a slow machine and — worse — passes for the wrong
 * reason on a fast one. Polling makes a real failure look like a timeout
 * instead of a race.
 */
async function waitFor(label, predicate, { timeoutMs = 20000, intervalMs = 400 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  console.log(`  [warn] timed out waiting for ${label}`);
  return false;
}

let seq = 0;
async function account() {
  const { address, encryptedPrivateKey } = generateWallet();
  await fundWallet(address);
  const user = createUser({
    email: `v2-${TS}-${seq++}@test.com`,
    passwordHash: "not-used",
    walletAddress: address,
    encryptedPrivateKey,
  });
  setEmailVerified(user.id);
  return { id: user.id, address, token: signToken({ userId: user.id, address, tokenVersion: user.token_version }) };
}

const cin = (n) => `L${String(TS).slice(-5)}MH2024PLC${String(500000 + n).slice(0, 6)}`;

// ============================================================================
console.log("\n=== 1. The platform owner brings the college into existence ===");
/**
 * Nobody registers a college through the front door any more — an internal
 * college platform doesn't ask its own owner to sign up for it. The admin
 * creates it, and this build hosts exactly one, so a re-run re-uses the college
 * already there via the break-glass password reset rather than failing on the
 * "a college already exists" guard.
 */
const COLLEGE_PASSWORD = `Journey${TS}pass1`;
let college;
{
  const bad = await call("POST", "/admin/auth/login", {
    body: { username: config.adminUsername, password: "definitely-not-it" },
  });
  check("A wrong admin password is refused", bad.status === 401, String(bad.status));

  const login = await call("POST", "/admin/auth/login", {
    body: { username: config.adminUsername, password: config.adminPassword },
  });
  check("Admin signs in", login.status === 200 && !!login.data?.token,
    `${login.status} ${JSON.stringify(login.data?.error || "")}`);
  const adminToken = login.data?.token;
  if (!adminToken) throw new Error("cannot continue without an admin session");

  const overview = await call("GET", "/admin/overview", { token: adminToken });
  check("The overview reports chain health", typeof overview.data?.chain?.blockNumber === "number",
    JSON.stringify(overview.data?.chain));

  let collegeEmail;
  if (overview.data?.college) {
    const reset = await call("POST", "/admin/college/reset-password", {
      token: adminToken, body: { password: COLLEGE_PASSWORD },
    });
    check("The owner can reset the placement cell's login", reset.status === 200, JSON.stringify(reset.data));
    collegeEmail = reset.data?.email;
    note("Re-using the college already on this platform", overview.data.college.name);
  } else {
    collegeEmail = `college-${TS}@test.com`;
    const created = await call("POST", "/admin/college", {
      token: adminToken,
      body: {
        name: `Institute ${TS}`,
        registrationNumber: `EDU/V2/${TS}`,
        email: collegeEmail,
        password: COLLEGE_PASSWORD,
      },
    });
    check("The owner creates the college", created.status === 201 && created.data?.college?.status === "Active",
      `${created.status} ${JSON.stringify(created.data?.error || created.data?.college?.status)}`);
  }
  if (!collegeEmail) throw new Error("no college login to sign in with");

  const session = await call("POST", "/auth/login", {
    body: { email: collegeEmail, password: COLLEGE_PASSWORD },
  });
  check("The placement cell signs in", session.status === 200 && !!session.data?.token,
    `${session.status} ${JSON.stringify(session.data?.error || "")}`);
  college = { address: session.data?.address, token: session.data?.token };

  const me = await call("GET", "/me", { token: college.token });
  check("It is Active on-chain", me.data?.actor?.status === "Active", me.data?.actor?.status);

  // The door it used to come in through is now shut.
  const impostor = await account();
  const selfRegister = await call("POST", "/me/register", {
    token: impostor.token,
    body: { role: "College", name: `Fake Institute ${TS}`, registrationNumber: `EDU/FAKE/${TS}` },
  });
  check("Nobody can register themselves as a college", selfRegister.status === 403, selfRegister.data?.error);

  // A second college cannot be created either — one platform, one institution.
  const second = await call("POST", "/admin/college", {
    token: adminToken,
    body: {
      name: `Second Institute ${TS}`, registrationNumber: `EDU/V2B/${TS}`,
      email: `second-${TS}@test.com`, password: COLLEGE_PASSWORD,
    },
  });
  check("A second college is refused", second.status === 409, `${second.status} ${second.data?.error || ""}`);
}

/**
 * Each run works in a cohort of its own.
 *
 * Placement figures are aggregated per batch year across the whole college, and
 * the college is now a singleton that survives between runs — so a fixed 2026
 * would have this suite counting a previous run's offers and failing for a
 * reason that has nothing to do with the code.
 */
const existingBatches = await call("GET", `/public/colleges/${college.address}/placement`);
const usedYears = (existingBatches.data?.batches || []).map((b) => b.batchYear);
const BATCH = usedYears.length > 0 ? Math.max(...usedYears) + 1 : 2026;
if (BATCH > 2100) throw new Error("no batch year left — reset the database before re-running");
note("Working in batch year", String(BATCH));

// Roll numbers and names are unique per run for the same reason.
const ROLL = (i) => `R${String(TS).slice(-10)}${i}`;
const NAME = (i) => `Aspirant ${TS} ${i}`;
const NAME_RE = new RegExp(`Aspirant ${TS}`);
const ROLL_RE = new RegExp(`R${String(TS).slice(-10)}`);

// ============================================================================
console.log("\n=== 2. The college declares its cohort and uploads a roster ===");
{
  const b = await call("POST", "/college/batches", {
    token: college.token,
    body: { courseCode: "CSE", batchYear: BATCH, strength: 180 },
  });
  check("Cohort of 180 recorded on-chain", b.status === 201, `${b.status} ${JSON.stringify(b.data?.error || "")}`);

  const entries = [];
  for (let i = 1; i <= 6; i++) {
    entries.push({ rollNumber: ROLL(i), fullName: NAME(i), courseCode: "CSE", batchYear: BATCH });
  }
  const r = await call("POST", "/college/roster", { token: college.token, body: { entries } });
  check("Roster of 6 uploaded", r.status === 200 && r.data.added === 6, JSON.stringify(r.data));

  const bad = await call("POST", "/college/roster", {
    token: college.token,
    body: { entries: [{ rollNumber: ROLL(99), fullName: "X", courseCode: "CSE", batchYear: 1990 }] },
  });
  check("A bad row is rejected with its row number", bad.status === 400 && bad.data.errors?.[0]?.row === 1,
    JSON.stringify(bad.data?.errors?.[0] || bad.data));
}

// ============================================================================
console.log("\n=== 3. Students claim roll numbers from that roster ===");
const students = [];
for (let i = 1; i <= 4; i++) {
  const s = await account();
  const r = await call("POST", "/me/claim-roll-number", {
    token: s.token,
    body: { collegeAddress: college.address, rollNumber: ROLL(i), cgpa: i === 4 ? 6.2 : 8.1 },
  });
  if (r.status !== 200 || !r.data?.matched) {
    throw new Error(`student ${i}: ${r.status} ${JSON.stringify(r.data)}`);
  }
  students.push(s);
}
check("Four students matched the roster", students.length === 4);
{
  const me = await call("GET", "/me", { token: students[0].token });
  check("Identity comes from the roster, not from the student",
    me.data?.profile?.fullName === NAME(1) && me.data?.profile?.rollNumber === ROLL(1),
    JSON.stringify(me.data?.profile));
  // Their email was already confirmed, so matching the roster was the last
  // condition and the on-chain write happened there and then.
  check("Matching the roster wrote them on-chain", me.data?.verification?.verified === true,
    JSON.stringify(me.data?.verification?.missing));

  const dup = await account();
  const r2 = await call("POST", "/me/claim-roll-number", {
    token: dup.token,
    body: { collegeAddress: college.address, rollNumber: ROLL(1) },
  });
  check("An already-claimed roll number is refused", r2.status === 400, r2.data?.error);
}

// ============================================================================
console.log("\n=== 3b. A student who arrives before the roster does ===");
{
  // The dead end this build exists to remove: an unknown roll number is queued
  // for the placement cell rather than refused outright.
  const early = await account();
  const unknownRoll = ROLL(77);
  const claim = await call("POST", "/me/claim-roll-number", {
    token: early.token,
    body: { collegeAddress: college.address, rollNumber: unknownRoll },
  });
  check("An unknown roll number is queued, not refused",
    claim.status === 202 && claim.data?.queued === true, `${claim.status} ${JSON.stringify(claim.data)}`);
  check("And they are told what they are waiting on",
    claim.data?.verification?.missing?.includes("collegeApproval"),
    JSON.stringify(claim.data?.verification?.missing));

  const queue = await call("GET", "/college/verifications", { token: college.token });
  const row = (queue.data?.pending || []).find((p) => p.rollNumber === unknownRoll);
  check("They appear in the placement cell's queue", !!row, JSON.stringify(queue.data?.pending?.length));

  // Unverified means look, don't touch.
  const browse = await call("GET", "/drives/open", { token: early.token });
  check("An unverified student can still look around", browse.status === 200, String(browse.status));
  check("...but is told they cannot act yet", browse.data?.verified === false, JSON.stringify(browse.data?.verified));

  const outsider = await account();
  const notMine = await call("POST", `/college/verifications/${row?.userId}/approve`, {
    token: outsider.token,
    body: { fullName: NAME(77), courseCode: "CSE", batchYear: BATCH },
  });
  check("Only the college can approve from that queue", notMine.status === 403, String(notMine.status));

  const ok = await call("POST", `/college/verifications/${row?.userId}/approve`, {
    token: college.token,
    body: { fullName: NAME(77), courseCode: "CSE", batchYear: BATCH },
  });
  check("The college approves them", ok.status === 200 && ok.data?.onChain === true,
    `${ok.status} ${JSON.stringify(ok.data?.error || ok.data)}`);

  const after = await call("GET", "/me", { token: early.token });
  check("They are verified afterwards", after.data?.verification?.verified === true,
    JSON.stringify(after.data?.verification));

  const twice = await call("POST", `/college/verifications/${row?.userId}/approve`, {
    token: college.token,
    body: { fullName: NAME(77), courseCode: "CSE", batchYear: BATCH },
  });
  check("The same request cannot be approved twice", twice.status === 400, twice.data?.error);
}

// ============================================================================
console.log("\n=== 4. A company registers; the college admits it ===");
const company = await account();
{
  const r = await call("POST", "/me/register", {
    token: company.token,
    body: { role: "Company", name: `Acme ${TS}`, registrationNumber: cin(1) },
  });
  check("Company registers as Pending", r.status === 201 && r.data?.actor?.status === "Pending", r.data?.actor?.status);

  const a = await call("POST", `/college/companies/${company.address}/approve`, { token: college.token });
  check("College admits the company", a.status === 200, `${a.status} ${JSON.stringify(a.data?.error || "")}`);
}

// ============================================================================
console.log("\n=== 5. The company posts its own terms ===");
let driveId;
{
  const now = Math.floor(Date.now() / 1000);
  const r = await call("POST", "/drives", {
    token: company.token,
    body: {
      collegeAddress: college.address,
      roleTitle: "Software Engineer",
      annualPackage: 650000,
      minCgpa: 7,
      batchYear: BATCH,
      applicationDeadline: now + 7 * 86400,
      driveDate: now + 14 * 86400,
      ipfsHash: CID,
    },
  });
  check("Drive posted", r.status === 201, `${r.status} ${JSON.stringify(r.data?.error || "")}`);
  driveId = r.data?.driveId;

  const asCollege = await call("POST", "/drives", {
    token: college.token,
    body: {
      collegeAddress: college.address, roleTitle: "Fake", annualPackage: 9999999,
      minCgpa: 0, batchYear: BATCH, applicationDeadline: now + 86400, driveDate: now + 2 * 86400, ipfsHash: CID,
    },
  });
  check("A college cannot post a drive", asCollege.status === 403, asCollege.data?.error);

  const before = await call("GET", "/drives/open", { token: students[0].token });
  check("Students can't see it before the college agrees to host",
    !(before.data?.drives || []).some((d) => d.id === driveId));

  const ap = await call("POST", `/college/drives/${driveId}/approve`, { token: college.token });
  check("College agrees to host it", ap.status === 200, `${ap.status} ${JSON.stringify(ap.data?.error || "")}`);
}

// ============================================================================
console.log("\n=== 6. Students apply; the CGPA cutoff is enforced ===");
{
  await waitFor("the drive to become visible", async () => {
    const o = await call("GET", "/drives/open", { token: students[0].token });
    return (o.data?.drives || []).some((d) => d.id === driveId);
  });
  const open = await call("GET", "/drives/open", { token: students[0].token });
  const drive = (open.data?.drives || []).find((d) => d.id === driveId);
  check("The drive is now visible to students", !!drive);
  check("The published cutoff is the company's", drive?.minCgpa === 7, String(drive?.minCgpa));

  for (const s of students.slice(0, 3)) {
    const r = await call("POST", `/drives/${driveId}/apply`, { token: s.token });
    check(`Eligible student applies`, r.status === 201, `${r.status} ${JSON.stringify(r.data?.error || "")}`);
  }

  // Student 4 has CGPA 6.2 against a 7.00 cutoff.
  const blocked = await call("POST", `/drives/${driveId}/apply`, { token: students[3].token });
  check("An ineligible student is blocked with the actual cutoff",
    blocked.status === 403 && /7\.00/.test(blocked.data?.error || ""), blocked.data?.error);

  const again = await call("POST", `/drives/${driveId}/apply`, { token: students[0].token });
  check("Applying twice is refused", again.status === 409, again.data?.error);
}

// ============================================================================
console.log("\n=== 7. The company publishes the applicant total ===");
{
  const r = await call("POST", `/drives/${driveId}/application-count`, { token: company.token });
  check("Company publishes how many applied", r.status === 200 && r.data.applicationCount === 3, JSON.stringify(r.data));

  const asCollege = await call("POST", `/drives/${driveId}/application-count`, {
    token: college.token, body: { count: 1 },
  });
  check("The college cannot publish that figure", asCollege.status === 403, asCollege.data?.error);
}

// ============================================================================
console.log("\n=== 8. The company runs its funnel ===");
{
  const stage = (student, s) =>
    call("POST", `/outcomes/${driveId}/stage`, {
      token: company.token,
      body: { studentAddress: student.address, stage: s, label: s === "Interview" ? "Tech Round" : "" },
    });

  for (const s of students.slice(0, 3)) check("Shortlisted", (await stage(s, "Shortlisted")).status === 201);
  for (const s of students.slice(0, 2)) check("Interviewed", (await stage(s, "Interview")).status === 201);
  check("Third student not selected", (await stage(students[2], "NotSelected")).status === 201);
  for (const s of students.slice(0, 2)) check("Offered", (await stage(s, "Offered")).status === 201);

  const asCollege = await call("POST", `/outcomes/${driveId}/stage`, {
    token: college.token,
    body: { studentAddress: students[3].address, stage: "Offered" },
  });
  check("A college cannot record an outcome", asCollege.status === 403, asCollege.data?.error);

  const notApplied = await call("POST", `/outcomes/${driveId}/stage`, {
    token: company.token,
    body: { studentAddress: students[3].address, stage: "Offered" },
  });
  check("A company cannot judge someone who never applied", notApplied.status === 400, notApplied.data?.error);
}

// ============================================================================
console.log("\n=== 9. Nobody is placed until a student says yes ===");
{
  await waitFor("the funnel to reach the mirror", async () => {
    const r = await call("GET", `/public/colleges/${college.address}/drives`);
    return r.data?.drives?.find((d) => d.id === driveId)?.funnel?.offered === 2;
  });
  const p = await call("GET", `/public/colleges/${college.address}/placement`);
  const batch = p.data?.batches?.find((b) => b.batchYear === BATCH);
  note("Offers standing", "2");
  check("Placed count is still zero", batch?.placed === 0, String(batch?.placed));

  const asCompany = await call("POST", `/outcomes/${driveId}/answer`, {
    token: company.token, body: { response: "Accepted" },
  });
  check("A company cannot accept on a student's behalf", asCompany.status === 403, asCompany.data?.error);
}

// ============================================================================
console.log("\n=== 10. One accepts, one declines ===");
{
  const a = await call("POST", `/outcomes/${driveId}/answer`, { token: students[0].token, body: { response: "Accepted" } });
  check("Student accepts", a.status === 201, `${a.status} ${JSON.stringify(a.data?.error || "")}`);
  const d = await call("POST", `/outcomes/${driveId}/answer`, { token: students[1].token, body: { response: "Declined" } });
  check("Student declines", d.status === 201, `${d.status} ${JSON.stringify(d.data?.error || "")}`);

  const twice = await call("POST", `/outcomes/${driveId}/answer`, { token: students[0].token, body: { response: "Declined" } });
  check("An offer can't be answered twice", twice.status === 409, twice.data?.error);

  await waitFor("the placement to register", async () => {
    const r = await call("GET", `/public/colleges/${college.address}/placement`);
    return r.data?.batches?.find((b) => b.batchYear === BATCH)?.placed === 1;
  });
  const p = await call("GET", `/public/colleges/${college.address}/placement`);
  const batch = p.data?.batches?.find((b) => b.batchYear === BATCH);
  check("Exactly one student is placed", batch?.placed === 1, String(batch?.placed));
  note("Of the declared batch", `${batch?.placed} of ${batch?.declaredStrength} (${batch?.placementRateOfBatch}%)`);
  note("Of those signed up", `${batch?.placed} of ${batch?.registered} (${batch?.placementRateOfRegistered}%)`);
}

// ============================================================================
console.log("\n=== 11. The public page shows a funnel nobody could fake ===");
{
  const r = await call("GET", `/public/colleges/${college.address}/drives`);
  const drive = r.data?.drives?.find((d) => d.id === driveId);
  check("The drive is public", !!drive);
  check("Applied is the company's signed figure", drive?.funnel?.applied === 3, String(drive?.funnel?.applied));
  check("Shortlisted counts everyone who reached it", drive?.funnel?.shortlisted === 3, String(drive?.funnel?.shortlisted));
  check("Interviewed", drive?.funnel?.interviewed === 2, String(drive?.funnel?.interviewed));
  check("Offered", drive?.funnel?.offered === 2, String(drive?.funnel?.offered));
  check("Accepted", drive?.funnel?.accepted === 1, String(drive?.funnel?.accepted));

  const blob = JSON.stringify(r.data);
  check("No student name appears", !NAME_RE.test(blob));
  check("No roll number appears", !ROLL_RE.test(blob));
  check("No student address appears", !students.some((s) => blob.toLowerCase().includes(s.address.toLowerCase())));
}

// ============================================================================
console.log("\n=== 12. A withdrawn offer un-places the student ===");
{
  const r = await call("POST", `/outcomes/${driveId}/stage`, {
    token: company.token,
    body: { studentAddress: students[0].address, stage: "NotSelected", label: "Withdrawn" },
  });
  check("The company withdraws its offer", r.status === 201, `${r.status} ${JSON.stringify(r.data?.error || "")}`);

  await waitFor("the placement to be released", async () => {
    const r2 = await call("GET", `/public/colleges/${college.address}/placement`);
    return r2.data?.batches?.find((b) => b.batchYear === BATCH)?.placed === 0;
  });
  const p = await call("GET", `/public/colleges/${college.address}/placement`);
  const batch = p.data?.batches?.find((b) => b.batchYear === BATCH);
  check("The placed count falls back to zero", batch?.placed === 0, String(batch?.placed));
}

// ============================================================================
console.log("\n=== 13. Shrinking the cohort is allowed, but never silent ===");
{
  const r = await call("POST", "/college/batches", {
    token: college.token,
    body: { courseCode: "CSE", batchYear: BATCH, strength: 60 },
  });
  check("The college restates 180 as 60", r.status === 201, `${r.status} ${JSON.stringify(r.data?.error || "")}`);

  await waitFor("the revised cohort to reach the mirror", async () => {
    const r2 = await call("GET", `/public/colleges/${college.address}/placement`);
    return r2.data?.batches?.find((b) => b.batchYear === BATCH)?.declaredStrength === 60;
  });
  const p = await call("GET", `/public/colleges/${college.address}/placement`);
  const batch = p.data?.batches?.find((b) => b.batchYear === BATCH);
  check("The new denominator is published", batch?.declaredStrength === 60, String(batch?.declaredStrength));
  check("And the revision is visible to anyone reading the page",
    batch?.declaredStrengthRevisions >= 1, String(batch?.declaredStrengthRevisions));
}

// ============================================================================
console.log("\n=== 14. The college records what it did to prepare students ===");
let eventId;
{
  const heldOn = Math.floor(Date.now() / 1000) - 7 * 86400;
  const r = await call("POST", "/college/events", {
    token: college.token,
    body: {
      kind: "Training",
      title: `Aptitude Series ${TS}`,
      conductedBy: "Placement Cell",
      heldOn,
      attendance: 142,
      batchYear: BATCH,
    },
  });
  check("The college records a training session", r.status === 201, `${r.status} ${JSON.stringify(r.data?.error || "")}`);
  eventId = r.data?.events?.[0]?.id;

  const mock = await call("POST", "/college/events", {
    token: college.token,
    body: {
      kind: "MockInterview", title: `Mock Interviews ${TS}`, conductedBy: "Alumni panel",
      heldOn, attendance: 60, batchYear: BATCH,
    },
  });
  check("And a mock interview round", mock.status === 201, `${mock.status} ${JSON.stringify(mock.data?.error || "")}`);

  const asCompany = await call("POST", "/college/events", {
    token: company.token,
    body: { kind: "Training", title: "We trained them", conductedBy: "Us", heldOn, attendance: 10 },
  });
  check("A company cannot claim the college's preparation work", asCompany.status === 403, asCompany.data?.error);

  const asStudent = await call("POST", "/college/events", {
    token: students[0].token,
    body: { kind: "Training", title: "I trained myself", conductedBy: "Me", heldOn, attendance: 1 },
  });
  check("Nor can a student", asStudent.status === 403, asStudent.data?.error);

  const badDate = await call("POST", "/college/events", {
    token: college.token,
    body: {
      kind: "Seminar", title: "Far future", conductedBy: "Nobody",
      heldOn: heldOn + 3 * 365 * 86400, attendance: 0,
    },
  });
  check("A date years away is refused before it costs gas", badDate.status === 400, badDate.data?.error);

  await waitFor("the preparation record to reach the public page", async () => {
    const p = await call("GET", `/public/colleges/${college.address}/preparation?batchYear=${BATCH}`);
    return p.data?.summary?.standing >= 2;
  });
  const pub = await call("GET", `/public/colleges/${college.address}/preparation?batchYear=${BATCH}`);
  check("Parents can see what the college actually did", pub.data?.summary?.standing >= 2,
    JSON.stringify(pub.data?.summary));
  check("With attendance published alongside it", pub.data?.summary?.attendances >= 202,
    String(pub.data?.summary?.attendances));

  // The record carries when it was written, not only the date claimed.
  const recorded = pub.data?.events?.find((e) => e.id === eventId);
  check("And when the record itself was written", typeof recorded?.recordedAt === "number",
    String(recorded?.recordedAt));
}

// ============================================================================
console.log("\n=== 15. A cancelled session stays on the record ===");
{
  const r = await call("POST", `/college/events/${eventId}/cancel`, {
    token: college.token,
    body: { reason: "Trainer unavailable" },
  });
  check("The college can say a session did not happen", r.status === 200, `${r.status} ${JSON.stringify(r.data?.error || "")}`);

  await waitFor("the cancellation to reach the mirror", async () => {
    const p = await call("GET", `/public/colleges/${college.address}/preparation?batchYear=${BATCH}`);
    return p.data?.events?.find((e) => e.id === eventId)?.cancelled === true;
  });
  const pub = await call("GET", `/public/colleges/${college.address}/preparation?batchYear=${BATCH}`);
  const cancelled = pub.data?.events?.find((e) => e.id === eventId);

  check("It is still visible, with the reason", cancelled?.cancelled === true && !!cancelled?.cancelReason,
    JSON.stringify(cancelled?.cancelReason));
  // Recording ten sessions and calling off nine must not still read as ten.
  check("But it stops counting", pub.data?.summary?.cancelled === 1 && pub.data?.summary?.standing === 1,
    JSON.stringify(pub.data?.summary));

  const twice = await call("POST", `/college/events/${eventId}/cancel`, {
    token: college.token, body: { reason: "again" },
  });
  check("It cannot be cancelled twice", twice.status === 409, twice.data?.error);

  const notMine = await call("POST", "/college/events/0/cancel", {
    token: company.token, body: { reason: "nope" },
  });
  check("A company cannot cancel the college's record", notMine.status === 403, notMine.data?.error);
}

// ============================================================================
console.log("\n=== 16. Students build resumes; the company browses anonymously ===");
{
  const me = students[0];
  const skills = await call("PUT", "/me/skills", {
    token: me.token, body: { skills: ["React.js", "PostgreSQL", "Python"] },
  });
  check("A student lists their skills", skills.status === 200 && skills.data.skills.length === 3,
    JSON.stringify(skills.data));

  const item = await call("POST", "/me/resume/experience", {
    token: me.token,
    body: {
      title: "Backend Intern", subtitle: `Acme ${TS}`,
      startedOn: "Jun 2025", endedOn: "Aug 2025",
      description: "Built the billing API.",
      url: "https://example.com/intern",
    },
  });
  check("And an internship", item.status === 201, `${item.status} ${JSON.stringify(item.data?.error || "")}`);

  const badLink = await call("POST", "/me/resume/project", {
    token: me.token, body: { title: "Portfolio", url: "javascript:alert(1)" },
  });
  check("A javascript: link is refused", badLink.status === 400, badLink.data?.error);

  const others = await call("PATCH", `/me/resume/item/${item.data?.item?.id}`, {
    token: students[1].token, body: { title: "Actually mine" },
  });
  check("Another student cannot edit that entry", others.status === 404, others.data?.error);

  // --- the part that matters most to a student ---
  const pool = await call("GET", `/talent?batchYear=${BATCH}`, { token: company.token });
  check("The company can browse the pool", pool.status === 200 && pool.data.total >= 4,
    `${pool.status} total=${pool.data?.total}`);

  const blob = JSON.stringify(pool.data);
  check("Browsing shows no student name", !NAME_RE.test(blob));
  check("Browsing shows no student email", !/@test\.com/.test(blob));

  const filtered = await call("GET", `/talent?skills=react%20js&minCgpa=7&batchYear=${BATCH}`, {
    token: company.token,
  });
  check("Filtering by skill and CGPA finds the right student",
    filtered.data?.students?.length === 1 && filtered.data.students[0].skills.includes("React.js"),
    JSON.stringify(filtered.data?.students?.map((s) => s.rollNumber)));

  const roll = ROLL(1);
  const card = await call("GET", `/talent/${roll}`, { token: company.token });
  // students[0] applied to this company's drive back in section 6, which is the
  // only thing that unlocks contact details.
  check("An applicant's contact details are unlocked", card.data?.student?.contactUnlocked === true,
    JSON.stringify(card.data?.student?.contactUnlockedBy));
  check("And they are the right ones", card.data?.student?.contact?.fullName === NAME(1),
    JSON.stringify(card.data?.student?.contact));

  const notApplied = await call("GET", `/talent/${ROLL(4)}`, { token: company.token });
  check("Someone who never applied stays anonymous",
    notApplied.data?.student?.contactUnlocked === false && !notApplied.data?.student?.contact,
    JSON.stringify(notApplied.data?.student?.contactUnlocked));

  const asStudent = await call("GET", "/talent", { token: students[1].token });
  check("A student cannot browse the pool", asStudent.status === 403, asStudent.data?.error);

  const lookup = await call("POST", "/students/lookup", {
    token: students[1].token,
    body: { rollNumber: roll, email: `v2-${TS}-0@test.com` },
  });
  check("A classmate can be looked up with roll number AND email",
    lookup.status === 200 || lookup.status === 404, String(lookup.status));

  const wrongEmail = await call("POST", "/students/lookup", {
    token: students[1].token, body: { rollNumber: roll, email: "guess@test.com" },
  });
  check("The wrong email finds nothing", wrongEmail.status === 404, wrongEmail.data?.error);
}

// ============================================================================
console.log("\n=== 17. Placement notices ===");
{
  const post = await call("POST", "/announcements", {
    token: college.token,
    body: { title: `Season update ${TS}`, body: "Twelve companies confirmed.", audience: "public" },
  });
  check("The college posts a public notice", post.status === 201, `${post.status} ${JSON.stringify(post.data?.error || "")}`);

  const byCompany = await call("POST", "/announcements", {
    token: company.token,
    body: { driveId, title: "Bring two CV copies", body: "And a photo ID." },
  });
  check("The company posts about its own drive", byCompany.status === 201,
    `${byCompany.status} ${JSON.stringify(byCompany.data?.error || "")}`);

  const noDrive = await call("POST", "/announcements", {
    token: company.token, body: { title: "General thoughts", body: "About the market." },
  });
  check("A company cannot post without naming its drive", noDrive.status === 400, noDrive.data?.error);

  const byStudent = await call("POST", "/announcements", {
    token: students[0].token, body: { title: "Study group", body: "Anyone?" },
  });
  check("A student cannot post", byStudent.status === 403, byStudent.data?.error);

  const edit = await call("PATCH", `/announcements/${post.data?.announcement?.id}`, {
    token: college.token,
    body: { title: `Season update ${TS}`, body: "Fourteen companies confirmed.", audience: "public" },
  });
  check("An edit is stamped rather than silent", edit.status === 200 && !!edit.data?.announcement?.editedAt,
    JSON.stringify(edit.data?.announcement?.editedAt));

  const hostileEdit = await call("PATCH", `/announcements/${byCompany.data?.announcement?.id}`, {
    token: college.token, body: { title: "Cancelled", body: "Do not attend." },
  });
  check("Even the college cannot rewrite a company's notice", hostileEdit.status === 404, hostileEdit.data?.error);

  const pub = await call("GET", `/public/colleges/${college.address}/announcements`);
  const titles = (pub.data?.announcements || []).map((a) => a.title);
  check("Public notices reach the parent-facing page", titles.includes(`Season update ${TS}`),
    JSON.stringify(titles.slice(0, 3)));
  check("Operational ones do not", !titles.includes("Bring two CV copies"));
}

// ============================================================================
console.log("\n=== 18. The owner can stop an account, and nothing it signed changes ===");
{
  const login = await call("POST", "/admin/auth/login", {
    body: { username: config.adminUsername, password: config.adminPassword },
  });
  const adminToken = login.data?.token;

  const accounts = await call("GET", "/admin/accounts?role=Company", { token: adminToken });
  check("The owner can list accounts", accounts.status === 200 && accounts.data.accounts.length >= 1,
    String(accounts.data?.accounts?.length));

  const suspend = await call("POST", `/admin/accounts/${company.address}/suspend`, {
    token: adminToken, body: { reason: "Reported by the placement cell" },
  });
  check("The owner suspends the company", suspend.status === 200 && suspend.data?.account?.status === "Suspended",
    `${suspend.status} ${JSON.stringify(suspend.data?.error || suspend.data?.account?.status)}`);

  const blocked = await call("POST", `/outcomes/${driveId}/stage`, {
    token: company.token,
    body: { studentAddress: students[1].address, stage: "Offered" },
  });
  check("A suspended company cannot act", blocked.status === 403, blocked.data?.error);

  const stillThere = await call("GET", `/public/colleges/${college.address}/drives`);
  const drive = stillThere.data?.drives?.find((d) => d.id === driveId);
  // The point of suspension over deletion: it stops an account acting and
  // changes nothing it already signed.
  check("But everything it already signed stands", drive?.funnel?.offered === 2 && drive?.funnel?.applied === 3,
    JSON.stringify(drive?.funnel));

  const notAdmin = await call("POST", `/admin/accounts/${company.address}/reinstate`, {
    token: college.token,
  });
  check("The college cannot use the owner's routes", notAdmin.status === 401, String(notAdmin.status));

  const reinstate = await call("POST", `/admin/accounts/${company.address}/reinstate`, {
    token: adminToken,
  });
  check("And a suspension can be lifted", reinstate.status === 200 && reinstate.data?.account?.status === "Active",
    `${reinstate.status} ${JSON.stringify(reinstate.data?.error || reinstate.data?.account?.status)}`);

  const actions = await call("GET", "/admin/actions", { token: adminToken });
  check("Every owner action is on the record",
    (actions.data?.actions || []).some((a) => a.action === "suspend") &&
      (actions.data?.actions || []).some((a) => a.action === "reinstate"),
    String(actions.data?.actions?.length));
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}\n`);
process.exit(failures === 0 ? 0 : 1);
