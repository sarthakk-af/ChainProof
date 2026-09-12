/**
 * Flow 7 — the public accountability surface: what an anonymous visitor can
 * see, what they must never see, and whether the published numbers agree with
 * the chain.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Resolved from this file's own location so the suite runs from any checkout.
const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(BACKEND_ROOT);
const src = (f) => pathToFileURL(path.join(BACKEND_ROOT, "src", f)).href;
const { createUser, setEmailVerified, getActor } = await import(src("db.js"));
const { signToken } = await import(src("auth.js"));
const { generateWallet } = await import(src("wallets.js"));
const { fundWallet } = await import(src("treasury.js"));
const { actorRegistryRead, credentialIssuerRead } = await import(src("chain.js"));

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
    email: `flow7-${TS}-${seq++}@test.com`,
    passwordHash: "not-used",
    walletAddress: address,
    encryptedPrivateKey,
  });
  setEmailVerified(user.id);
  return { id: user.id, address, token: signToken({ userId: user.id, address, tokenVersion: user.token_version }) };
}

let idSeq = 0;
const regId = () => `EDU/F7/${TS}/${idSeq++}`;
const cin = (n) => `L${String(TS).slice(-5)}MH2025PLC${String(400000 + n).slice(0, 6)}`;

const adminLogin = await call("POST", "/admin/auth/login", { body: { username: "sarthak", password: "AdminPass123" } });
const adminToken = adminLogin.data?.token;
if (!adminToken) throw new Error("admin login failed");

async function activeCollege(name) {
  const a = await account();
  await call("POST", "/me/register", { token: a.token, body: { role: "College", name, registrationNumber: regId() } });
  await call("POST", `/admin/actors/${a.address}/approve`, { token: adminToken });
  const jc = await call("GET", "/me/join-code", { token: a.token });
  return { ...a, joinCode: jc.data.joinCode, name };
}
async function activeCompany(name, n) {
  const a = await account();
  await call("POST", "/me/register", { token: a.token, body: { role: "Company", name, registrationNumber: cin(n) } });
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

const collegeA = await activeCollege("Public Institute A " + TS);
const collegeB = await activeCollege("Public Institute B " + TS);
const company = await activeCompany("Public Hiring " + TS, 1);
const alice = await studentOf(collegeA, "Alice Anonymous");
const bob = await studentOf(collegeB, "Bob Elsewhere");

await call("POST", "/credentials/issue", {
  token: company.token,
  body: { studentAddress: alice.address, credType: "Offer", ipfsHash: CID },
});
await new Promise((r) => setTimeout(r, 1500));

// --- A -----------------------------------------------------------------------
console.log("\n=== A. What an anonymous visitor can reach ===");
{
  const roster = await call("GET", "/students");
  check("The student roster is NOT public", roster.status === 401,
    `status ${roster.status}${roster.status === 200 ? ` — leaked ${roster.data?.students?.length} students` : ""}`);

  const history = await call("GET", `/students/${alice.address}/credentials`);
  check("An individual's credential history is NOT public", history.status === 401,
    `status ${history.status}`);

  // These are meant to be open — the whole point of the project.
  const overview = await call("GET", "/public/overview");
  check("The public overview is open", overview.status === 200, `status ${overview.status}`);
  const colleges = await call("GET", "/public/colleges");
  check("The public college list is open", colleges.status === 200, `status ${colleges.status}`);
  const records = await call("GET", `/public/colleges/${collegeA.address}/records`);
  check("Per-college records are open", records.status === 200, `status ${records.status}`);
}

// --- B -----------------------------------------------------------------------
console.log("\n=== B. The privacy boundary on public records ===");
{
  const records = await call("GET", `/public/colleges/${collegeA.address}/records`);
  const blob = JSON.stringify(records.data);
  check("Alice's name does not appear", !blob.includes("Alice Anonymous"));
  check("Alice's address does not appear", !blob.toLowerCase().includes(alice.address.toLowerCase()));
  check("No studentAddress field is present", !/"studentAddress"/.test(blob));
  check("The issuing company IS named", blob.includes("Public Hiring"));
  note("A record as published", JSON.stringify(records.data?.records?.[0] || {}));

  const colleges = await call("GET", "/public/colleges");
  const cblob = JSON.stringify(colleges.data);
  check("No join code is ever published", !cblob.includes(collegeA.joinCode) && !cblob.includes(collegeB.joinCode));
  const dir = await call("GET", "/colleges");
  check("The college directory leaks no join code", !JSON.stringify(dir.data).includes(collegeA.joinCode));
}

// --- C -----------------------------------------------------------------------
console.log("\n=== C. Who may read a student's record once signed in ===");
{
  const own = await call("GET", `/students/${alice.address}/credentials`, { token: alice.token });
  check("Alice can read her own history", own.status === 200, `status ${own.status}`);

  const peer = await call("GET", `/students/${alice.address}/credentials`, { token: bob.token });
  check("A fellow student cannot read Alice's history", peer.status === 403, `status ${peer.status}`);

  const ownCollege = await call("GET", `/students/${alice.address}/credentials`, { token: collegeA.token });
  check("Alice's own college can read it", ownCollege.status === 200, `status ${ownCollege.status}`);

  const otherCollege = await call("GET", `/students/${alice.address}/credentials`, { token: collegeB.token });
  check("An unrelated college cannot", otherCollege.status === 403, `status ${otherCollege.status}`);

  const byCompany = await call("GET", `/students/${alice.address}/credentials`, { token: company.token });
  check("A verified company can (it recruits)", byCompany.status === 200, `status ${byCompany.status}`);

  const peerRoster = await call("GET", "/students", { token: bob.token });
  check("A student cannot enumerate other students", peerRoster.status === 403, `status ${peerRoster.status}`);
}

// --- D -----------------------------------------------------------------------
console.log("\n=== D. A college is confined to its own roster ===");
{
  const mine = await call("GET", "/students", { token: collegeA.token });
  const names = (mine.data?.students || []).map((s) => s.name);
  check("College A sees its own student", names.includes("Alice Anonymous"), names.join(", "));
  check("College A does NOT see College B's student", !names.includes("Bob Elsewhere"), names.join(", "));

  // Asking for someone else's roster explicitly must not work either.
  const spoof = await call("GET", `/students?college=${collegeB.address}`, { token: collegeA.token });
  const spoofNames = (spoof.data?.students || []).map((s) => s.name);
  check("Overriding the college filter is ignored", !spoofNames.includes("Bob Elsewhere"), spoofNames.join(", "));
}

// --- E -----------------------------------------------------------------------
console.log("\n=== E. Do the published numbers match the chain? ===");
{
  const pub = await call("GET", "/public/colleges");
  const row = pub.data.colleges.find((c) => c.address === collegeA.address);
  const [onChainRegistered, onChainPlaced] = await Promise.all([
    actorRegistryRead.totalRegisteredStudents(collegeA.address),
    credentialIssuerRead.totalPlacedStudents(collegeA.address),
  ]);
  note("Published", `${row?.placed}/${row?.registered} (${row?.percentage}%)`);
  note("On chain", `${Number(onChainPlaced)}/${Number(onChainRegistered)}`);
  check("Published placed count matches the chain", row?.placed === Number(onChainPlaced));
  check("Published registered count matches the chain", row?.registered === Number(onChainRegistered));

  const bad = await call("GET", "/public/colleges/not-an-address/records");
  check("A malformed college address is handled", bad.status === 404 || bad.status === 400, `status ${bad.status}`);
  const missing = await call("GET", "/public/colleges/0x000000000000000000000000000000000000dEaD/records");
  check("An unknown college returns 404", missing.status === 404, `status ${missing.status}`);
  const student = await call("GET", `/public/colleges/${alice.address}/records`);
  check("A student address is not treated as a college", student.status === 404, `status ${student.status}`);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}\n`);
process.exit(failures === 0 ? 0 : 1);
