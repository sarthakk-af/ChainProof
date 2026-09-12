/**
 * Full cross-role end-to-end journey against the live local stack.
 * Drives the real HTTP API only — the one exception is seeding a known OTP
 * hash, because OTPs are deliberately never readable after they're sent.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Resolved from this file's own location so the suite runs from any checkout.
const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(BACKEND_ROOT);
const src = (f) => pathToFileURL(path.join(BACKEND_ROOT, "src", f)).href;
const { setEmailOtp, getUserByEmail } = await import(src("db.js"));
const { hashOtp } = await import(src("auth.js"));

const BASE = process.env.API_URL || "http://127.0.0.1:4000";
const TS = Date.now();
const PW = "TestPass123";
const CID = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
let failures = 0;

function check(label, cond, detail = "") {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`  [${mark}] ${label}${detail ? "  -- " + detail : ""}`);
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  return { status: res.status, data };
}

/** Sign up, verify the email through the real OTP endpoint, and log in. */
async function onboard(label, email) {
  const signup = await call("POST", "/auth/signup", { body: { email, password: PW } });
  if (signup.status === 429) {
    console.error(
      `
  Signup is rate-limited (10 per 15 minutes per IP) and the budget is spent.
` +
        `  This journey needs three real signups. Wait ~15 minutes and re-run, or
` +
        `  restart the backend to clear the in-memory counter.
`
    );
    process.exit(1);
  }
  check(`${label}: signup accepted`, signup.status === 201 || signup.status === 200, `status ${signup.status}`);
  check(`${label}: signup returns no session token`, !signup.data?.token);

  const blocked = await call("POST", "/auth/login", { body: { email, password: PW } });
  check(`${label}: login blocked before verification`, blocked.status === 403 && blocked.data?.requiresVerification === true, `status ${blocked.status}`);

  const user = getUserByEmail(email);
  const OTP = "424242";
  setEmailOtp({ userId: user.id, otpHash: hashOtp(OTP), expiresAt: Date.now() + 10 * 60 * 1000 });

  const wrong = await call("POST", "/auth/verify-email", { body: { email, otp: "000000" } });
  check(`${label}: wrong OTP rejected`, wrong.status === 400, `status ${wrong.status}`);

  const right = await call("POST", "/auth/verify-email", { body: { email, otp: OTP } });
  check(`${label}: correct OTP verifies`, right.status === 200, `status ${right.status}`);

  const login = await call("POST", "/auth/login", { body: { email, password: PW } });
  check(`${label}: login works after verification`, login.status === 200 && !!login.data?.token, `status ${login.status}`);
  return login.data.token;
}

console.log("\n=== 1. College onboards ===");
const collegeToken = await onboard("College", `e2e-college-${TS}@test.com`);

const collegeReg = await call("POST", "/me/register", {
  token: collegeToken,
  body: { role: "College", name: `E2E Institute ${TS}`, website: "https://example.com", registrationNumber: `EDU/E2E/${TS}` },
});
check("College registers and lands Pending", collegeReg.status === 201 && collegeReg.data?.actor?.status === "Pending", `status ${collegeReg.status} ${JSON.stringify(collegeReg.data?.error || "")}`);
const collegeAddress = collegeReg.data?.actor?.address;

console.log("\n=== 2. Admin reviews and approves ===");
const adminLogin = await call("POST", "/admin/auth/login", { body: { username: "sarthak", password: "AdminPass123" } });
check("Admin logs in", adminLogin.status === 200 && !!adminLogin.data?.token, `status ${adminLogin.status}`);
const adminToken = adminLogin.data?.token;

const queue = await call("GET", "/admin/actors?status=Pending", { token: adminToken });
const queued = queue.data?.actors?.find((a) => a.address === collegeAddress);
check("College appears in the pending queue", !!queued);
check("Admin sees the registration number as evidence", queued?.registrationNumber === `EDU/E2E/${TS}`, queued?.registrationNumber);

const approve = await call("POST", `/admin/actors/${collegeAddress}/approve`, { token: adminToken });
check("Approval succeeds on-chain", approve.status === 200 && approve.data?.actor?.status === "Active", `status ${approve.status}`);
check("Approval is recorded with a tx hash", !!approve.data?.txHash);

const joinCodeRes = await call("GET", "/me/join-code", { token: collegeToken });
check("Active college immediately has a join code", joinCodeRes.status === 200 && !!joinCodeRes.data?.joinCode, joinCodeRes.data?.joinCode);
const joinCode = joinCodeRes.data?.joinCode;

console.log("\n=== 3. Student onboards using the college's invite code ===");
const studentToken = await onboard("Student", `e2e-student-${TS}@test.com`);

const badCode = await call("POST", "/me/register", {
  token: studentToken,
  body: { role: "Student", name: "E2E Student", collegeAddress, joinCode: "WRONGCODE" },
});
check("Student with a wrong invite code is refused", badCode.status === 400, `status ${badCode.status}`);

const studentReg = await call("POST", "/me/register", {
  token: studentToken,
  body: { role: "Student", name: "E2E Student", collegeAddress, joinCode },
});
check("Student with the correct code registers Active instantly", studentReg.status === 201 && studentReg.data?.actor?.status === "Active", `status ${studentReg.status} ${JSON.stringify(studentReg.data?.error || "")}`);
const studentAddress = studentReg.data?.actor?.address;

console.log("\n=== 4. Company onboards and is approved ===");
const companyToken = await onboard("Company", `e2e-company-${TS}@test.com`);
const CIN = `L${String(TS).slice(-5)}MH2022PLC${String(TS).slice(-6)}`;

const noCin = await call("POST", "/me/register", { token: companyToken, body: { role: "Company", name: "E2E Corp" } });
check("Company without a CIN is refused", noCin.status === 400, `status ${noCin.status}`);

const companyReg = await call("POST", "/me/register", {
  token: companyToken,
  body: { role: "Company", name: "E2E Corp", website: "https://example.com", registrationNumber: CIN },
});
check("Company registers with a valid CIN", companyReg.status === 201 && companyReg.data?.actor?.status === "Pending", `status ${companyReg.status} ${JSON.stringify(companyReg.data?.error || "")}`);
const companyAddress = companyReg.data?.actor?.address;

const companyApprove = await call("POST", `/admin/actors/${companyAddress}/approve`, { token: adminToken });
check("Company approved on-chain", companyApprove.status === 200 && companyApprove.data?.actor?.status === "Active", `status ${companyApprove.status}`);

console.log("\n=== 5. College announces a visit ===");
const visit = await call("POST", "/visits/announce", {
  token: collegeToken,
  body: { companyName: "E2E Corp", visitDate: Math.floor(Date.now() / 1000) + 86400, ipfsHash: CID },
});
check("Visit announced", visit.status === 201 || visit.status === 200, `status ${visit.status} ${JSON.stringify(visit.data?.error || "")}`);

console.log("\n=== 6. Company issues an Offer; student becomes placed ===");
const junk = await call("POST", "/credentials/issue", {
  token: companyToken,
  body: { studentAddress, credType: "Offer", ipfsHash: "not-a-real-hash" },
});
check("Junk IPFS hash is refused before reaching the chain", junk.status === 400, "status " + junk.status);

const offer = await call("POST", "/credentials/issue", {
  token: companyToken,
  body: { studentAddress, credType: "Offer", ipfsHash: CID },
});
check("Offer credential issued", offer.status === 201 || offer.status === 200, `status ${offer.status} ${JSON.stringify(offer.data?.error || "")}`);
check("Issuance is anchored by a tx hash", !!offer.data?.txHash);

await new Promise((r) => setTimeout(r, 1500));
const afterOffer = await call("GET", "/public/colleges");
const collegeAfterOffer = afterOffer.data?.colleges?.find((c) => c.address === collegeAddress);
check("Public dashboard shows the college", !!collegeAfterOffer);
check("Public dashboard labels it by registration number", collegeAfterOffer?.registrationNumber === `EDU/E2E/${TS}`, collegeAfterOffer?.registrationNumber);
check("Student counts as placed publicly", collegeAfterOffer?.placed === 1 && collegeAfterOffer?.percentage === 100, `placed=${collegeAfterOffer?.placed} pct=${collegeAfterOffer?.percentage}`);

const records = await call("GET", `/public/colleges/${collegeAddress}/records`);
check("Anyone can drill into the record without logging in", records.status === 200 && records.data?.records?.length === 1, `count ${records.data?.records?.length}`);
check("Record names the issuer but not the student", records.data?.records?.[0]?.issuerName === "E2E Corp" && !("studentAddress" in (records.data?.records?.[0] || {})));

console.log("\n=== 7. Company rescinds the offer via a correction ===");
const offerId = records.data?.records?.[0]?.id;
const correction = await call("POST", `/credentials/${offerId}/correct`, {
  token: companyToken,
  body: { studentAddress, credType: "Rejection", ipfsHash: CID },
});
check("Correction issued", correction.status === 201 || correction.status === 200, `status ${correction.status} ${JSON.stringify(correction.data?.error || "")}`);

await new Promise((r) => setTimeout(r, 1500));
const afterCorrection = await call("GET", "/public/colleges");
const collegeFinal = afterCorrection.data?.colleges?.find((c) => c.address === collegeAddress);
check("Placement drops back to 0 after the rescind", collegeFinal?.placed === 0 && collegeFinal?.percentage === 0, `placed=${collegeFinal?.placed} pct=${collegeFinal?.percentage}`);

const finalRecords = await call("GET", `/public/colleges/${collegeAddress}/records`);
check("Both the original and the correction remain visible (append-only)", finalRecords.data?.records?.length === 2, `count ${finalRecords.data?.records?.length}`);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}\n`);
process.exit(failures === 0 ? 0 : 1);
