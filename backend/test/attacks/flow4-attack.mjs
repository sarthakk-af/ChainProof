/**
 * Flow 4 — a college running its placement cell: join codes, visit
 * announcements, credential issuance, and the authority boundaries on each.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Resolved from this file's own location so the suite runs from any checkout.
const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(BACKEND_ROOT);
const src = (f) => pathToFileURL(path.join(BACKEND_ROOT, "src", f)).href;
const { createUser, setEmailVerified, getActor, getPerCollegePlacementStats, getCredentialsForStudent } =
  await import(src("db.js"));
const { signToken } = await import(src("auth.js"));
const { generateWallet } = await import(src("wallets.js"));
const { fundWallet } = await import(src("treasury.js"));

const BASE = process.env.API_URL || "http://127.0.0.1:4000";
const TS = Date.now();
const CID = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
let failures = 0;

function check(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${detail ? "  -- " + detail : ""}`);
}
function note(label, detail) {
  console.log(`  [NOTE] ${label}${detail ? "  -- " + detail : ""}`);
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data };
}

let seq = 0;
async function account() {
  const { address, encryptedPrivateKey } = generateWallet();
  await fundWallet(address);
  const user = createUser({
    email: `flow4-${TS}-${seq++}@test.com`,
    passwordHash: "not-used",
    walletAddress: address,
    encryptedPrivateKey,
  });
  setEmailVerified(user.id);
  return { id: user.id, address, token: signToken({ userId: user.id, address, tokenVersion: user.token_version }) };
}

let regSeq = 0;
function regId() {
  return `EDU/F4/${TS}/${regSeq++}`;
}

const adminLogin = await call("POST", "/admin/auth/login", { body: { username: "sarthak", password: "AdminPass123" } });
const adminToken = adminLogin.data?.token;
if (!adminToken) throw new Error("admin login failed: " + adminLogin.status);

/** A verified, Active college with its join code. */
async function activeCollege(name) {
  const a = await account();
  const r = await call("POST", "/me/register", {
    token: a.token,
    body: { role: "College", name, registrationNumber: regId() },
  });
  if (r.status !== 201) throw new Error(`college setup: ${r.status} ${JSON.stringify(r.data)}`);
  const ap = await call("POST", `/admin/actors/${a.address}/approve`, { token: adminToken });
  if (ap.status !== 200) throw new Error(`approve: ${ap.status} ${JSON.stringify(ap.data)}`);
  const jc = await call("GET", "/me/join-code", { token: a.token });
  return { ...a, joinCode: jc.data.joinCode, name };
}

async function studentOf(college, name) {
  const a = await account();
  const r = await call("POST", "/me/register", {
    token: a.token,
    body: { role: "Student", name, collegeAddress: college.address, joinCode: college.joinCode },
  });
  if (r.status !== 201) throw new Error(`student setup: ${r.status} ${JSON.stringify(r.data)}`);
  return a;
}

// --- A -----------------------------------------------------------------------
console.log("\n=== A. Acting before verification ===");
{
  const a = await account();
  await call("POST", "/me/register", { token: a.token, body: { role: "College", name: "Unapproved Poly", registrationNumber: regId() } });
  check("A Pending college cannot announce a visit",
    (await call("POST", "/visits/announce", { token: a.token, body: { companyName: "X", visitDate: 2000000000, ipfsHash: CID } })).status === 403);
  check("A Pending college cannot issue a credential",
    (await call("POST", "/credentials/issue", { token: a.token, body: { studentAddress: a.address, credType: "General", ipfsHash: CID } })).status === 403);
  check("A Pending college has no join code",
    (await call("GET", "/me/join-code", { token: a.token })).status === 403);
  check("A Pending college cannot regenerate a join code",
    (await call("POST", "/me/join-code/regenerate", { token: a.token })).status === 403);

  const rej = await account();
  await call("POST", "/me/register", { token: rej.token, body: { role: "College", name: "Rejected Poly", registrationNumber: regId() } });
  await call("POST", `/admin/actors/${rej.address}/reject`, { token: adminToken, body: { reason: "test" } });
  check("A Rejected college cannot issue",
    (await call("POST", "/credentials/issue", { token: rej.token, body: { studentAddress: rej.address, credType: "General", ipfsHash: CID } })).status === 403);
}

// --- B -----------------------------------------------------------------------
console.log("\n=== B. Join code boundaries ===");
const collegeA = await activeCollege("Alpha Institute " + TS);
const collegeB = await activeCollege("Beta Institute " + TS);
{
  const outsider = await account();
  check("A non-college cannot read a join code",
    (await call("GET", "/me/join-code", { token: outsider.token })).status === 403);
  check("A non-college cannot regenerate one",
    (await call("POST", "/me/join-code/regenerate", { token: outsider.token })).status === 403);

  const before = collegeA.joinCode;
  const regen = await call("POST", "/me/join-code/regenerate", { token: collegeA.token });
  check("A college can regenerate its own code", regen.status === 200 && regen.data.joinCode !== before,
    `${before} -> ${regen.data?.joinCode}`);
  collegeA.joinCode = regen.data.joinCode;

  const stale = await account();
  const withOld = await call("POST", "/me/register", {
    token: stale.token,
    body: { role: "Student", name: "Late Joiner", collegeAddress: collegeA.address, joinCode: before },
  });
  check("The superseded code no longer works", withOld.status === 400, `status ${withOld.status}`);

  const crossCode = await account();
  const wrongCollege = await call("POST", "/me/register", {
    token: crossCode.token,
    body: { role: "Student", name: "Wrong Door", collegeAddress: collegeB.address, joinCode: collegeA.joinCode },
  });
  check("College A's code cannot enrol a student into College B", wrongCollege.status === 400, `status ${wrongCollege.status}`);

  // Two regenerates fired together must not leave the code ambiguous.
  const [g1, g2] = await Promise.all([
    call("POST", "/me/join-code/regenerate", { token: collegeB.token }),
    call("POST", "/me/join-code/regenerate", { token: collegeB.token }),
  ]);
  const stored = getActor(collegeB.address)?.join_code;
  const returned = [g1.data?.joinCode, g2.data?.joinCode];
  check("After concurrent regenerates the stored code is one of the two returned",
    returned.includes(stored), `stored ${stored}, returned ${returned.join(" / ")}`);
  const fresh = await call("GET", "/me/join-code", { token: collegeB.token });
  check("And reading it back agrees with storage", fresh.data?.joinCode === stored, `${fresh.data?.joinCode} vs ${stored}`);
  collegeB.joinCode = stored;
}

// --- C -----------------------------------------------------------------------
console.log("\n=== C. Who may a college issue to? ===");
const studentA = await studentOf(collegeA, "Alpha Student");
const studentB = await studentOf(collegeB, "Beta Student");
{
  const own = await call("POST", "/credentials/issue", {
    token: collegeA.token,
    body: { studentAddress: studentA.address, credType: "General", ipfsHash: CID },
  });
  check("A college can issue to its own student", own.status === 201, `status ${own.status}`);

  // College A has no relationship with College B's student.
  const foreign = await call("POST", "/credentials/issue", {
    token: collegeA.token,
    body: { studentAddress: studentB.address, credType: "General", ipfsHash: CID },
  });
  check("A college CANNOT issue to another college's student", foreign.status === 403,
    `status ${foreign.status} ${JSON.stringify(foreign.data?.error || "")}`);

  const toCollege = await call("POST", "/credentials/issue", {
    token: collegeA.token,
    body: { studentAddress: collegeB.address, credType: "General", ipfsHash: CID },
  });
  check("A college cannot issue to another college", toCollege.status === 400, `status ${toCollege.status}`);
}

// --- D -----------------------------------------------------------------------
console.log("\n=== D. Can a college declare its own students placed? ===");
{
  const before = getPerCollegePlacementStats().get(collegeA.address);
  const selfOffer = await call("POST", "/credentials/issue", {
    token: collegeA.token,
    body: { studentAddress: studentA.address, credType: "Offer", ipfsHash: CID },
  });
  await new Promise((r) => setTimeout(r, 1200));
  const after = getPerCollegePlacementStats().get(collegeA.address);
  note("College self-issued an Offer", `HTTP ${selfOffer.status}`);
  note("Placement before", `${before?.placed || 0}/${before?.registered || 0}`);
  note("Placement after", `${after?.placed || 0}/${after?.registered || 0}`);
  check("A college cannot mark its own student placed",
    selfOffer.status !== 201 || (after?.placed || 0) === (before?.placed || 0),
    selfOffer.status === 201 ? "the Offer was accepted and counted" : "refused");
}

// --- E -----------------------------------------------------------------------
console.log("\n=== E. Visit announcement input ===");
{
  const past = await call("POST", "/visits/announce", {
    token: collegeA.token,
    body: { companyName: "Past Corp", visitDate: 946684800, ipfsHash: CID },
  });
  note("A visit dated in the year 2000", `HTTP ${past.status}`);

  check("A zero visit date is refused",
    (await call("POST", "/visits/announce", { token: collegeA.token, body: { companyName: "X", visitDate: 0, ipfsHash: CID } })).status === 400);
  check("A non-integer visit date is refused",
    (await call("POST", "/visits/announce", { token: collegeA.token, body: { companyName: "X", visitDate: "tomorrow", ipfsHash: CID } })).status === 400);
  check("An empty company name is refused",
    (await call("POST", "/visits/announce", { token: collegeA.token, body: { companyName: "   ", visitDate: 2000000000, ipfsHash: CID } })).status === 400);
  const longName = "C".repeat(151);
  check("An over-long company name is refused",
    (await call("POST", "/visits/announce", { token: collegeA.token, body: { companyName: longName, visitDate: 2000000000, ipfsHash: CID } })).status === 400);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}\n`);
process.exit(failures === 0 ? 0 : 1);
