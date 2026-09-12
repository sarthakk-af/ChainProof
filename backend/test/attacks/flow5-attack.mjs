/**
 * Flow 5 — a company hiring: offers, corrections, and the placement number
 * they move. Companies hold the only credential type that changes the public
 * statistic, so anything they can do wrongly matters more than elsewhere.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Resolved from this file's own location so the suite runs from any checkout.
const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(BACKEND_ROOT);
const src = (f) => pathToFileURL(path.join(BACKEND_ROOT, "src", f)).href;
const { createUser, setEmailVerified, getCredentialsForStudent, getPerCollegePlacementStats } =
  await import(src("db.js"));
const { signToken } = await import(src("auth.js"));
const { generateWallet } = await import(src("wallets.js"));
const { fundWallet } = await import(src("treasury.js"));

const BASE = process.env.API_URL || "http://127.0.0.1:4000";
const TS = Date.now();
const CID = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
const CID2 = "QmWATWQ7fVPP2EFGu71UkfnqhYXDYH566qy47CnJDgvs8u";
let failures = 0;

function check(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${detail ? "  -- " + detail : ""}`);
}
function note(label, detail = "") {
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
    email: `flow5-${TS}-${seq++}@test.com`,
    passwordHash: "not-used",
    walletAddress: address,
    encryptedPrivateKey,
  });
  setEmailVerified(user.id);
  return { id: user.id, address, token: signToken({ userId: user.id, address, tokenVersion: user.token_version }) };
}

let idSeq = 0;
const regId = () => `EDU/F5/${TS}/${idSeq++}`;
const cin = (n) => `L${String(TS).slice(-5)}MH2024PLC${String(300000 + n).slice(0, 6)}`;

const adminLogin = await call("POST", "/admin/auth/login", { body: { username: "sarthak", password: "AdminPass123" } });
const adminToken = adminLogin.data?.token;
if (!adminToken) throw new Error("admin login failed");

async function activeCollege(name) {
  const a = await account();
  const r = await call("POST", "/me/register", { token: a.token, body: { role: "College", name, registrationNumber: regId() } });
  if (r.status !== 201) throw new Error(`college: ${r.status} ${JSON.stringify(r.data)}`);
  await call("POST", `/admin/actors/${a.address}/approve`, { token: adminToken });
  const jc = await call("GET", "/me/join-code", { token: a.token });
  return { ...a, joinCode: jc.data.joinCode };
}
async function activeCompany(name, n) {
  const a = await account();
  const r = await call("POST", "/me/register", { token: a.token, body: { role: "Company", name, registrationNumber: cin(n) } });
  if (r.status !== 201) throw new Error(`company: ${r.status} ${JSON.stringify(r.data)}`);
  await call("POST", `/admin/actors/${a.address}/approve`, { token: adminToken });
  return a;
}
async function studentOf(college, name) {
  const a = await account();
  const r = await call("POST", "/me/register", {
    token: a.token,
    body: { role: "Student", name, collegeAddress: college.address, joinCode: college.joinCode },
  });
  if (r.status !== 201) throw new Error(`student: ${r.status} ${JSON.stringify(r.data)}`);
  return a;
}

const college = await activeCollege("Flow5 Institute " + TS);
const acme = await activeCompany("Acme Hiring " + TS, 1);
const globex = await activeCompany("Globex Hiring " + TS, 2);

// --- A -----------------------------------------------------------------------
console.log("\n=== A. Issuing before verification ===");
{
  const pending = await account();
  await call("POST", "/me/register", { token: pending.token, body: { role: "Company", name: "Unapproved Co", registrationNumber: cin(3) } });
  const s = await studentOf(college, "Victim A");
  check("A Pending company cannot issue an Offer",
    (await call("POST", "/credentials/issue", { token: pending.token, body: { studentAddress: s.address, credType: "Offer", ipfsHash: CID } })).status === 403);
}

// --- B -----------------------------------------------------------------------
console.log("\n=== B. Idempotency key bound to its payload? ===");
{
  const s1 = await studentOf(college, "Key Student One");
  const s2 = await studentOf(college, "Key Student Two");
  const key = `attack-${TS}`;

  const first = await call("POST", "/credentials/issue", {
    token: acme.token,
    body: { studentAddress: s1.address, credType: "Offer", ipfsHash: CID, idempotencyKey: key },
  });
  check("First issuance succeeds", first.status === 201, `status ${first.status}`);

  // Same key, DIFFERENT student. If the key is memoized on (user, key) alone,
  // this returns the first call's receipt and reports success — while nothing
  // at all is written for the second student.
  const second = await call("POST", "/credentials/issue", {
    token: acme.token,
    body: { studentAddress: s2.address, credType: "Offer", ipfsHash: CID, idempotencyKey: key },
  });
  await new Promise((r) => setTimeout(r, 1200));
  const s2creds = getCredentialsForStudent(s2.address);
  note("Second call (same key, different student)", `HTTP ${second.status}`);
  note("Credentials actually written for student two", String(s2creds.length));
  check("A reused key with a different payload does not report a false success",
    second.status !== 201 || s2creds.length > 0,
    second.status === 201 && s2creds.length === 0
      ? "reported 201 but wrote nothing — silent data loss"
      : "ok");

  // A genuine retry — same key, same payload — must still be safe.
  const retry = await call("POST", "/credentials/issue", {
    token: acme.token,
    body: { studentAddress: s1.address, credType: "Offer", ipfsHash: CID, idempotencyKey: key },
  });
  await new Promise((r) => setTimeout(r, 800));
  check("A true retry is still de-duplicated", retry.status === 201 &&
    getCredentialsForStudent(s1.address).length === 1,
    `status ${retry.status}, credentials ${getCredentialsForStudent(s1.address).length}`);
}

// --- C -----------------------------------------------------------------------
console.log("\n=== C. Correcting someone else's record ===");
const student = await studentOf(college, "Shared Student");
{
  const issued = await call("POST", "/credentials/issue", {
    token: acme.token, body: { studentAddress: student.address, credType: "Offer", ipfsHash: CID },
  });
  check("Acme issues an Offer", issued.status === 201, `status ${issued.status}`);
  await new Promise((r) => setTimeout(r, 1200));
  const id = getCredentialsForStudent(student.address)[0].id;

  const foreign = await call("POST", `/credentials/${id}/correct`, {
    token: globex.token, body: { studentAddress: student.address, credType: "Rejection", ipfsHash: CID2 },
  });
  check("A different company cannot correct Acme's credential", foreign.status === 403, `status ${foreign.status}`);

  const byCollege = await call("POST", `/credentials/${id}/correct`, {
    token: college.token, body: { studentAddress: student.address, credType: "Rejection", ipfsHash: CID2 },
  });
  check("The student's own college cannot correct it either", byCollege.status === 403, `status ${byCollege.status}`);

  const bogus = await call("POST", `/credentials/999999/correct`, {
    token: acme.token, body: { studentAddress: student.address, credType: "Rejection", ipfsHash: CID2 },
  });
  check("Correcting a non-existent credential is refused", bogus.status === 404, `status ${bogus.status}`);
}

// --- D -----------------------------------------------------------------------
console.log("\n=== D. Double-correcting the same credential ===");
{
  const id = getCredentialsForStudent(student.address)[0].id;
  const [c1, c2] = await Promise.all([
    call("POST", `/credentials/${id}/correct`, { token: acme.token, body: { studentAddress: student.address, credType: "Rejection", ipfsHash: CID2 } }),
    call("POST", `/credentials/${id}/correct`, { token: acme.token, body: { studentAddress: student.address, credType: "Rejection", ipfsHash: CID2 } }),
  ]);
  const won = [c1, c2].filter((r) => r.status === 201).length;
  check("Exactly one of two concurrent corrections succeeds", won === 1,
    `statuses ${[c1.status, c2.status].sort().join(",")}`);
  const loser = [c1, c2].find((r) => r.status !== 201);
  check("The loser is refused without a chain revert", loser?.status === 409,
    `status ${loser?.status} ${JSON.stringify(loser?.data?.error || "")}`);

  await new Promise((r) => setTimeout(r, 1200));
  const creds = getCredentialsForStudent(student.address);
  check("Only one correction row exists", creds.filter((c) => c.is_correction).length === 1,
    `corrections ${creds.filter((c) => c.is_correction).length}`);
}

// --- E -----------------------------------------------------------------------
console.log("\n=== E. Two offers, one rescinded ===");
{
  const s = await studentOf(college, "Two Offers Student");
  await call("POST", "/credentials/issue", { token: acme.token, body: { studentAddress: s.address, credType: "Offer", ipfsHash: CID } });
  await call("POST", "/credentials/issue", { token: globex.token, body: { studentAddress: s.address, credType: "Offer", ipfsHash: CID2 } });
  await new Promise((r) => setTimeout(r, 1500));

  const beforeStats = getPerCollegePlacementStats().get(college.address);
  const acmeCred = getCredentialsForStudent(s.address).find(
    (c) => c.issuer_address.toLowerCase() === acme.address.toLowerCase()
  );
  const rescind = await call("POST", `/credentials/${acmeCred.id}/correct`, {
    token: acme.token, body: { studentAddress: s.address, credType: "Rejection", ipfsHash: CID2 },
  });
  check("Acme can rescind its own offer", rescind.status === 201, `status ${rescind.status}`);
  await new Promise((r) => setTimeout(r, 1500));

  const afterStats = getPerCollegePlacementStats().get(college.address);
  note("Placed before rescind", String(beforeStats?.placed ?? 0));
  note("Placed after rescind", String(afterStats?.placed ?? 0));
  check("The student stays placed — Globex's offer still stands",
    (afterStats?.placed ?? 0) === (beforeStats?.placed ?? 0),
    `${beforeStats?.placed} -> ${afterStats?.placed}`);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}\n`);
process.exit(failures === 0 ? 0 : 1);
