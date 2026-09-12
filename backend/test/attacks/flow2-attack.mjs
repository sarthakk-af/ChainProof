/**
 * Flow 2 — attacking the "claiming an identity" path directly over HTTP,
 * bypassing the UI's client-side validation entirely.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Resolved from this file's own location so the suite runs from any checkout.
const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(BACKEND_ROOT);
const src = (f) => pathToFileURL(path.join(BACKEND_ROOT, "src", f)).href;
const { createUser, setEmailVerified, getActor, getRegistrationNumberClaim, db } = await import(src("db.js"));
const { signToken } = await import(src("auth.js"));
const { generateWallet } = await import(src("wallets.js"));
const { fundWallet } = await import(src("treasury.js"));

const BASE = process.env.API_URL || "http://127.0.0.1:4000";
const TS = Date.now();
const PW = "TestPass123";
let failures = 0;

function check(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${detail ? "  -- " + detail : ""}`);
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
/**
 * Creates a ready-to-use account through the same internals /auth/signup
 * uses, rather than over HTTP.
 *
 * Not a shortcut around a check: the target of this file is /me/register, and
 * driving signup itself would exhaust its rate limiter (10 per 15 minutes per
 * IP) long before the attacks below finish — that limiter working is a
 * separate, already-verified property, not something to disable.
 */
async function account() {
  const email = `flow2-${TS}-${seq++}@test.com`;
  const { address, encryptedPrivateKey } = generateWallet();
  await fundWallet(address);
  const user = createUser({
    email,
    passwordHash: "not-used-in-this-suite",
    walletAddress: address,
    encryptedPrivateKey,
  });
  setEmailVerified(user.id);
  const token = signToken({ userId: user.id, address, tokenVersion: user.token_version });
  return { token, address, email };
}

function cin(n) {
  const d = String(TS).slice(-5);
  return `L${d}MH2022PLC${String(100000 + n).slice(0, 6)}`;
}

console.log("\n=== A. Two concurrent registrations from ONE account ===");
{
  const a = await account();
  // Fired together: if the guard is a naive check-then-act, both pass the
  // "already registered?" test before either writes, and the account ends up
  // registered twice — two chain writes, two gas payments.
  const [r1, r2] = await Promise.all([
    call("POST", "/me/register", { token: a.token, body: { role: "Company", name: "Race Co", registrationNumber: cin(1) } }),
    call("POST", "/me/register", { token: a.token, body: { role: "Company", name: "Race Co", registrationNumber: cin(1) } }),
  ]);
  const statuses = [r1.status, r2.status].sort().join(",");
  const succeeded = [r1, r2].filter((r) => r.status === 201).length;
  check("Exactly one of two concurrent registrations succeeds", succeeded === 1, `statuses ${statuses}`);
  // The loser must be refused before reaching the chain. A 400 here means it
  // sent a transaction that reverted — correct end state, but gas paid for
  // nothing, which on a real network is a cost an attacker controls.
  const loser = [r1, r2].find((r) => r.status !== 201);
  check("The losing request is refused without touching the chain", loser?.status === 409,
    `status ${loser?.status} ${JSON.stringify(loser?.data?.error || "")}`);
  const actor = getActor(a.address);
  check("The account has exactly one actor row", !!actor, actor ? actor.name : "none");
}

console.log("\n=== B. Two different accounts race for the SAME CIN ===");
{
  const [a, b] = await Promise.all([account(), account()]);
  const sharedCin = cin(2);
  const [r1, r2] = await Promise.all([
    call("POST", "/me/register", { token: a.token, body: { role: "Company", name: "Alpha Ltd", registrationNumber: sharedCin } }),
    call("POST", "/me/register", { token: b.token, body: { role: "Company", name: "Beta Ltd", registrationNumber: sharedCin } }),
  ]);
  const won = [r1, r2].filter((r) => r.status === 201).length;
  check("Exactly one account wins the CIN", won === 1, `statuses ${[r1.status, r2.status].sort().join(",")}`);
  const claim = getRegistrationNumberClaim(sharedCin);
  check("The claim table holds it for exactly one address", !!claim, claim?.address);
  const rows = db.prepare("SELECT COUNT(*) c FROM actors WHERE registration_number = ?").get(sharedCin);
  check("Only one actor carries that CIN", rows.c === 1, `count ${rows.c}`);
}

console.log("\n=== C. CIN submitted in lowercase / with padding ===");
{
  const a = await account();
  const target = cin(3);
  const r1 = await call("POST", "/me/register", { token: a.token, body: { role: "Company", name: "Case Ltd", registrationNumber: target } });
  check("Baseline registration succeeds", r1.status === 201, `status ${r1.status}`);

  const b = await account();
  const r2 = await call("POST", "/me/register", {
    token: b.token,
    body: { role: "Company", name: "Sneaky Ltd", registrationNumber: "  " + target.toLowerCase() + "  " },
  });
  check("Same CIN in lowercase + padding is still refused", r2.status === 409, `status ${r2.status}`);
}

console.log("\n=== D. A Student cannot squat a CIN ===");
{
  const a = await account();
  const squat = cin(4);
  // Students have no registration number field — passing one must be ignored,
  // not stored, or a student could reserve a company's CIN pre-emptively.
  const r = await call("POST", "/me/register", {
    token: a.token,
    body: { role: "Student", name: "Squatter", collegeAddress: "0x0000000000000000000000000000000000000001", joinCode: "XXXX", registrationNumber: squat },
  });
  check("Student registration with a bogus college is refused", r.status === 400, `status ${r.status}`);
  check("No claim was created for the squatted CIN", !getRegistrationNumberClaim(squat));
}

console.log("\n=== E. Role confusion on collegeAddress ===");
{
  const company = await account();
  await call("POST", "/me/register", { token: company.token, body: { role: "Company", name: "NotACollege", registrationNumber: cin(5) } });

  const student = await account();
  const r = await call("POST", "/me/register", {
    token: student.token,
    body: { role: "Student", name: "Confused", collegeAddress: company.address, joinCode: "ANYTHING" },
  });
  check("A Student cannot enrol into a Company", r.status === 400, `status ${r.status}`);

  const self = await account();
  const r2 = await call("POST", "/me/register", {
    token: self.token,
    body: { role: "Student", name: "SelfEnrol", collegeAddress: self.address, joinCode: "ANYTHING" },
  });
  check("A Student cannot enrol into themselves", r2.status === 400, `status ${r2.status}`);
}

console.log("\n=== F. Hostile website values ===");
{
  const a = await account();
  for (const bad of ["javascript:alert(1)", "ftp://x.com", "data:text/html,<script>", "notaurl", "http://"]) {
    const r = await call("POST", "/me/register", {
      token: a.token,
      body: { role: "Company", name: "Web Ltd", website: bad, registrationNumber: cin(9) },
    });
    check(`website "${bad}" refused`, r.status === 400, `status ${r.status}`);
  }
  check("No CIN claim leaked from the rejected website attempts", !getRegistrationNumberClaim(cin(9)));
}

console.log("\n=== G. An Active actor cannot change role ===");
{
  const a = await account();
  const r1 = await call("POST", "/me/register", { token: a.token, body: { role: "Company", name: "Fixed Ltd", registrationNumber: cin(6) } });
  check("Registered as Company", r1.status === 201, `status ${r1.status}`);
  const r2 = await call("POST", "/me/register", { token: a.token, body: { role: "College", name: "Now A College", registrationNumber: "EDU/X/1" } });
  check("Re-registering as a different role is refused", r2.status === 409, `status ${r2.status}`);
}

console.log("\n=== H. Oversized fields ===");
{
  const a = await account();
  const longName = "A".repeat(101);
  const r = await call("POST", "/me/register", { token: a.token, body: { role: "Company", name: longName, registrationNumber: cin(7) } });
  check("A 101-byte name is refused", r.status === 400, `status ${r.status}`);
  const devanagari = "अ".repeat(40); // 120 bytes, only 40 characters
  const r2 = await call("POST", "/me/register", { token: a.token, body: { role: "Company", name: devanagari, registrationNumber: cin(8) } });
  check("A 40-character / 120-byte Devanagari name is refused", r2.status === 400, `status ${r2.status}`);
  check("No claim leaked from the rejected attempts", !getRegistrationNumberClaim(cin(7)) && !getRegistrationNumberClaim(cin(8)));
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}\n`);
process.exit(failures === 0 ? 0 : 1);
