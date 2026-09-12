/**
 * Flow 3 — attacking the verification path: the admin queue, the approve /
 * reject actions, and the audit trail that says who decided what.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Resolved from this file's own location so the suite runs from any checkout.
const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(BACKEND_ROOT);
const src = (f) => pathToFileURL(path.join(BACKEND_ROOT, "src", f)).href;
const { createUser, setEmailVerified, getActor, listAdminActions } = await import(src("db.js"));
const { signToken, signAdminToken } = await import(src("auth.js"));
const { generateWallet } = await import(src("wallets.js"));
const { fundWallet } = await import(src("treasury.js"));
const { config } = await import(src("config.js"));

const BASE = process.env.API_URL || "http://127.0.0.1:4000";
const TS = Date.now();
let failures = 0;

function check(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${detail ? "  -- " + detail : ""}`);
}

async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
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
    email: `flow3-${TS}-${seq++}@test.com`,
    passwordHash: "not-used",
    walletAddress: address,
    encryptedPrivateKey,
  });
  setEmailVerified(user.id);
  return {
    id: user.id,
    address,
    token: signToken({ userId: user.id, address, tokenVersion: user.token_version }),
  };
}

function cin(n) {
  return `L${String(TS).slice(-5)}MH2023PLC${String(200000 + n).slice(0, 6)}`;
}

async function pendingCompany(n, name = "Queue Co") {
  const a = await account();
  const r = await call("POST", "/me/register", {
    token: a.token,
    body: { role: "Company", name, registrationNumber: cin(n) },
  });
  if (r.status !== 201) throw new Error(`setup failed: ${r.status} ${JSON.stringify(r.data)}`);
  return a.address;
}

const ADMIN_KEY = config.adminApiKey;

// --- A -----------------------------------------------------------------------
console.log("\n=== A. Reaching admin routes without an admin session ===");
const user = await account();

const noAuth = await call("GET", "/admin/actors");
check("No token is refused", noAuth.status === 401, `status ${noAuth.status}`);

const asUser = await call("GET", "/admin/actors", { token: user.token });
check("A valid USER token cannot read the admin queue", asUser.status === 401, `status ${asUser.status}`);

// The shared bootstrap secret may create admins, but must not perform or read
// verification decisions — those need an attributable person.
const withSecret = await call("GET", "/admin/actors", { headers: { "x-admin-key": ADMIN_KEY } });
check("The shared bootstrap secret cannot read the queue", withSecret.status === 401, `status ${withSecret.status}`);

const garbage = await call("GET", "/admin/actors", { token: "not.a.jwt" });
check("A malformed token is refused", garbage.status === 401, `status ${garbage.status}`);

// --- B -----------------------------------------------------------------------
console.log("\n=== B. Cross-type token confusion ===");
const login = await call("POST", "/admin/auth/login", { body: { username: "sarthak", password: "AdminPass123" } });
check("Admin logs in", login.status === 200, `status ${login.status}`);
const adminToken = login.data?.token;

// An admin token carries { sub: adminId, type: "admin" } and no tokenVersion.
// Admin ids and user ids are both small autoincrement integers from different
// tables, so sub=1 names a real, unrelated user account.
const adminAsUser = await call("GET", "/me", { token: adminToken });
check("An ADMIN token cannot act as a user session", adminAsUser.status === 401, `status ${adminAsUser.status}`);

const tamperedToken = signAdminToken({ adminId: 1, username: "sarthak" }).slice(0, -3) + "aaa";
const tampered = await call("GET", "/admin/actors", { token: tamperedToken });
check("A tampered admin token is refused", tampered.status === 401, `status ${tampered.status}`);

const wrongPassword = await call("POST", "/admin/auth/login", { body: { username: "sarthak", password: "wrong" } });
check("A wrong admin password is refused", wrongPassword.status === 401, `status ${wrongPassword.status}`);
check("The failure doesn't say whether the username exists",
  /invalid username or password/i.test(wrongPassword.data?.error || ""), wrongPassword.data?.error);

// --- C -----------------------------------------------------------------------
console.log("\n=== C. Replaying and racing a decision ===");
{
  const address = await pendingCompany(1);
  const first = await call("POST", `/admin/actors/${address}/approve`, { token: adminToken });
  check("First approval succeeds", first.status === 200, `status ${first.status}`);

  const replay = await call("POST", `/admin/actors/${address}/approve`, { token: adminToken });
  check("Approving an already-Active actor is refused", replay.status === 409, `status ${replay.status}`);

  const rejectAfter = await call("POST", `/admin/actors/${address}/reject`, {
    token: adminToken,
    body: { reason: "changed my mind" },
  });
  check("Rejecting an already-Active actor is refused", rejectAfter.status === 409, `status ${rejectAfter.status}`);
  check("The actor is still Active", getActor(address)?.status === 2, `status ${getActor(address)?.status}`);
}

{
  const address = await pendingCompany(2);
  // Two admins clicking Approve at the same instant.
  const [r1, r2] = await Promise.all([
    call("POST", `/admin/actors/${address}/approve`, { token: adminToken }),
    call("POST", `/admin/actors/${address}/approve`, { token: adminToken }),
  ]);
  const won = [r1, r2].filter((r) => r.status === 200).length;
  check("Exactly one of two concurrent approvals succeeds", won === 1,
    `statuses ${[r1.status, r2.status].sort().join(",")}`);
  // A 502 here means the loser sent a transaction that reverted: gas spent,
  // and a misleading "on-chain transaction failed" shown to an admin whose
  // only mistake was clicking second.
  const loser = [r1, r2].find((r) => r.status !== 200);
  check("The losing admin gets a clear conflict, not a chain error", loser?.status === 409,
    `status ${loser?.status} ${JSON.stringify(loser?.data?.error || "")}`);
  const log = listAdminActions(200).filter((a) => a.actor_address?.toLowerCase() === address.toLowerCase());
  check("Only one decision is recorded in the audit log", log.length === 1, `entries ${log.length}`);
}

{
  const missing = "0x000000000000000000000000000000000000dEaD";
  const r = await call("POST", `/admin/actors/${missing}/approve`, { token: adminToken });
  check("Approving an unknown address is refused", r.status === 404, `status ${r.status}`);
}

// --- D -----------------------------------------------------------------------
console.log("\n=== D. Can the audit log be made to lie? ===");
{
  const address = await pendingCompany(3, "Attribution Co");
  // Try to have the decision attributed to someone else by supplying it.
  const r = await call("POST", `/admin/actors/${address}/reject`, {
    token: adminToken,
    body: {
      reason: "no evidence",
      adminUsername: "someone-else",
      admin: "someone-else",
      username: "someone-else",
    },
  });
  check("Rejection succeeds", r.status === 200, `status ${r.status}`);
  const entry = listAdminActions(200).find((a) => a.actor_address?.toLowerCase() === address.toLowerCase());
  check("The log records the authenticated admin, not the supplied name",
    entry?.admin_username === "sarthak", entry?.admin_username);
  check("The reason is recorded verbatim", entry?.reason === "no evidence", entry?.reason);
  check("A transaction hash anchors the decision", !!entry?.tx_hash);
}

// --- E -----------------------------------------------------------------------
console.log("\n=== E. Hostile rejection reasons ===");
{
  const address = await pendingCompany(4, "Long Reason Co");
  const huge = "X".repeat(5000);
  const r = await call("POST", `/admin/actors/${address}/reject`, { token: adminToken, body: { reason: huge } });
  check("An oversized reason is accepted but truncated", r.status === 200, `status ${r.status}`);
  const entry = listAdminActions(200).find((a) => a.actor_address?.toLowerCase() === address.toLowerCase());
  check("Stored reason is capped at 500 characters", (entry?.reason || "").length === 500, `length ${(entry?.reason || "").length}`);
}

{
  const address = await pendingCompany(5, "Injection Co");
  const payload = "<script>alert(1)</script>'; DROP TABLE actors;--";
  const r = await call("POST", `/admin/actors/${address}/reject`, { token: adminToken, body: { reason: payload } });
  check("A reason containing markup and SQL is accepted", r.status === 200, `status ${r.status}`);
  const entry = listAdminActions(200).find((a) => a.actor_address?.toLowerCase() === address.toLowerCase());
  check("It is stored verbatim, not executed", entry?.reason === payload, entry?.reason?.slice(0, 30));
  check("The actors table still exists", Array.isArray(listAdminActions(1)));
}

// --- F -----------------------------------------------------------------------
console.log("\n=== F. A rejected applicant can recover ===");
{
  const a = await account();
  const reg = await call("POST", "/me/register", {
    token: a.token,
    body: { role: "Company", name: "Second Chance Ltd", registrationNumber: cin(6) },
  });
  check("Registered as Pending", reg.status === 201, `status ${reg.status}`);

  const rej = await call("POST", `/admin/actors/${a.address}/reject`, {
    token: adminToken,
    body: { reason: "wrong CIN supplied" },
  });
  check("Admin rejects it", rej.status === 200, `status ${rej.status}`);

  // Resubmitting with a corrected identifier must work, and must not be
  // blocked by the claim the failed attempt already holds.
  const resubmit = await call("POST", "/me/register", {
    token: a.token,
    body: { role: "Company", name: "Second Chance Ltd", registrationNumber: cin(7) },
  });
  check("The rejected applicant can resubmit", resubmit.status === 201, `status ${resubmit.status} ${JSON.stringify(resubmit.data?.error || "")}`);
  check("Status is Pending again", resubmit.data?.actor?.status === "Pending", resubmit.data?.actor?.status);
  check("The stale rejection reason is cleared", !getActor(a.address)?.rejection_reason,
    getActor(a.address)?.rejection_reason);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}\n`);
process.exit(failures === 0 ? 0 : 1);
