/**
 * seed.mjs — one command that turns a freshly deployed chain into a system you
 * can actually click through.
 *
 * Without this, getting started is a genuine dead end. A student can't register
 * until a college uploads a roster; a college can't do anything until the
 * platform verifier admits it; and the verifier is a private key, not a screen.
 * So the first person to open the app sees three roles, none of which work, and
 * no indication of why.
 *
 * This creates the smallest real system: one college (already admitted), a
 * declared cohort, a roster, one admitted company, and — optionally — a drive
 * with students partway through it.
 *
 *   npm run seed        college + cohort + roster + company
 *   npm run seed:full   the above, plus students, resumes, a drive and a funnel
 *
 * (A separate script rather than `npm run seed -- --full`: PowerShell strips the
 * `--`, so npm swallows the flag and the full seed silently never runs.)
 *
 * Every account it creates uses the same password, printed at the end. It is a
 * development convenience and refuses to run against anything but a local chain.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(BACKEND_ROOT);
const src = (f) => pathToFileURL(path.join(BACKEND_ROOT, "src", f)).href;

const { config } = await import(src("config.js"));

// A seeded account is a known password and a skipped email check. That is fine
// on a throwaway chain and unacceptable anywhere else.
function isLocal(url) {
  try {
    const { hostname } = new URL(url);
    return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname);
  } catch {
    return false;
  }
}
if (!isLocal(config.rpcUrl)) {
  console.error(`Refusing to seed against a non-local chain (${config.rpcUrl}).`);
  process.exit(1);
}

const { createUser, setEmailVerified, getUserByEmail, db } = await import(src("db.js"));
const { hashPassword } = await import(src("auth.js"));
const { generateWallet } = await import(src("wallets.js"));
const { fundWallet } = await import(src("treasury.js"));
const { actorRegistryAsVerifier, provider } = await import(src("chain.js"));
const { DEPLOYMENT } = await import(
  pathToFileURL(path.resolve(BACKEND_ROOT, "../frontend/src/contracts/deployment.js")).href
);

const BASE = process.env.API_URL || `http://127.0.0.1:${config.port}`;
const PASSWORD = "SeedPass123";
const FULL = process.argv.includes("--full");

// --- preflight ---------------------------------------------------------------

async function preflight() {
  for (const [name, contract] of Object.entries(DEPLOYMENT.contracts)) {
    const code = await provider.getCode(contract.address);
    if (code === "0x") {
      console.error(
        `\nNo contract found at the ${name} address in the deployment manifest.\n` +
          `The chain has been restarted since the last deploy. Run:\n\n` +
          `  npm run deploy:local        (from D:\\Blockchain)\n`
      );
      process.exit(1);
    }
  }
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    console.error(
      `\nThe backend isn't answering at ${BASE}.\n` +
        `Start it first:  cd backend && npm start\n`
    );
    process.exit(1);
  }
}

// --- helpers -----------------------------------------------------------------

async function call(method, urlPath, { token, body } = {}) {
  const res = await fetch(BASE + urlPath, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (res.status >= 400) {
    throw new Error(`${method} ${urlPath} -> ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

/** Creates a verified account and returns a usable session. */
async function account(email) {
  const existing = getUserByEmail(email);
  if (existing) {
    // Top the wallet up before reusing it. A local chain restart wipes every
    // balance while this database keeps the accounts, so a reused login is
    // funded on the old chain and broke on the new one — surfacing as an
    // undecodable revert from the first transaction it tried to send.
    await fundWallet(existing.wallet_address);
    const login = await call("POST", "/auth/login", { body: { email, password: PASSWORD } });
    return { email, address: existing.wallet_address, token: login.token };
  }
  const { address, encryptedPrivateKey } = generateWallet();
  await fundWallet(address);
  const user = createUser({
    email,
    passwordHash: await hashPassword(PASSWORD),
    walletAddress: address,
    encryptedPrivateKey,
  });
  // Skipping the OTP is the whole point of a seed: the email flow is verified
  // by its own tests, and a demo shouldn't need a working inbox.
  // Verified up front: on-chain registration waits for a confirmed email, and a
  // demo should not need a working inbox.
  setEmailVerified(user.id);
  const login = await call("POST", "/auth/login", { body: { email, password: PASSWORD } });
  return { email, address, token: login.token };
}

async function waitFor(label, predicate, { timeoutMs = 20000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`timed out waiting for ${label}`);
}

const step = (n, text) => console.log(`\n[${n}] ${text}`);

// --- seed --------------------------------------------------------------------

await preflight();

const stamp = Date.now().toString().slice(-6);

// A real CIN is exactly 21 characters: L + 5-digit industry code + 2-letter
// state + 4-digit year + 3-letter type + 6-digit number. Built piecewise rather
// than sliced, because a slice that happens to be the right length can still be
// the wrong shape — which is exactly what the format check is for.
const CIN = `L${stamp.slice(0, 5)}MH2020PLC${stamp.padStart(6, "0")}`;

step(1, "Creating the college through the admin");
const adminLogin = await call("POST", "/admin/auth/login", {
  body: { username: config.adminUsername, password: process.env.ADMIN_PASSWORD },
});
const adminToken = adminLogin.token;

const overview = await call("GET", "/admin/overview", { token: adminToken });
let collegeAddress = overview.college?.address ?? null;
const COLLEGE_EMAIL = "cell@seed.local";
let COLLEGE_LOGIN_EMAIL = COLLEGE_EMAIL;

if (!collegeAddress) {
  const created = await call("POST", "/admin/college", {
    token: adminToken,
    body: {
      name: "Somaiya Institute of Technology",
      registrationNumber: `EDU/MH/2024/${stamp}`,
      website: "https://example.com",
      email: COLLEGE_EMAIL,
      password: PASSWORD,
    },
  });
  collegeAddress = created.college.address;
  console.log("    college created and admitted");
} else {
  console.log("    college already exists — continuing");
}

// A college may already exist from an earlier run or a manual setup, under a
// different login. Rather than give up, reset it through the admin — which is
// exactly what that break-glass exists for, and keeps this script idempotent
// against whatever state the machine is already in.
let collegeToken;
try {
  const login = await call("POST", "/auth/login", { body: { email: COLLEGE_EMAIL, password: PASSWORD } });
  collegeToken = login.token;
} catch {
  const reset = await call("POST", "/admin/college/reset-password", {
    token: adminToken,
    body: { password: PASSWORD },
  });
  console.log(`    reset the existing placement-cell login (${reset.email})`);
  const login = await call("POST", "/auth/login", { body: { email: reset.email, password: PASSWORD } });
  collegeToken = login.token;
  COLLEGE_LOGIN_EMAIL = reset.email;
}
const college = { address: collegeAddress, token: collegeToken };

step(2, "Declaring cohorts");
for (const [course, year, strength] of [["CSE", 2026, 180], ["MECH", 2026, 90]]) {
  try {
    await call("POST", "/college/batches", {
      token: college.token,
      body: { courseCode: course, batchYear: year, strength },
    });
    console.log(`    ${course} ${year}: ${strength} students`);
  } catch (err) {
    console.log(`    ${course} ${year}: ${err.message}`);
  }
}

step(3, "Uploading the roster");
const NAMES = [
  "Asha Patil", "Rahul Nair", "Sara Khan", "Vikram Rao", "Neha Joshi",
  "Arjun Menon", "Priya Desai", "Karan Shah", "Meera Iyer", "Rohit Verma",
];
const roster = NAMES.map((fullName, i) => ({
  rollNumber: `21CE10${41 + i}`,
  fullName,
  courseCode: "CSE",
  batchYear: 2026,
}));
const uploaded = await call("POST", "/college/roster", { token: college.token, body: { entries: roster } });
console.log(`    ${uploaded.added} added, ${uploaded.updated} updated`);

step(4, "Registering a company and admitting it");
const company = await account(`company@seed.local`);
try {
  await call("POST", "/me/register", {
    token: company.token,
    body: {
      role: "Company",
      name: "Acme Technologies",
      registrationNumber: CIN,
      website: "https://example.com",
    },
  });
} catch (err) {
  if (!/already registered/.test(err.message)) throw err;
  console.log("    (already registered — continuing)");
}
const companyActor = await call("GET", "/college/companies", { token: college.token });
if (companyActor.companies.find((c) => c.address.toLowerCase() === company.address.toLowerCase())?.status === "Pending") {
  await call("POST", `/college/companies/${company.address}/approve`, { token: college.token });
}
console.log("    company admitted by the college");

// Everything after this point adds records that cannot be removed from a chain:
// drives, stages, preparation sessions. Running the seed a second time used to
// add a second identical set, which on the public page looked like invented
// data. If this company already has a drive here, the chain is already seeded.
const { drives: existingDrives } = await call("GET", "/drives/mine", { token: company.token });
if (existingDrives.length > 0) {
  console.log("\nThis chain is already seeded — nothing new was added.");
  if (FULL) {
    // Students are still confirmed, so their logins below work even if the
    // chain was reset since they last were.
    for (let i = 0; i < 5; i++) {
      const s = await account(`student${i + 1}@seed.local`);
      try {
        await call("POST", "/me/claim-roll-number", {
          token: s.token,
          body: { collegeAddress: college.address, rollNumber: roster[i].rollNumber },
        });
      } catch (err) {
        if (!/already verified/.test(err.message)) throw err;
      }
    }
  }
  printSummary("Already seeded.");
  db.close();
  process.exit(0);
}

step(5, "Recording what the college did to prepare students");
const daysAgo = (n) => Math.floor(Date.now() / 1000) - n * 86400;
const PREPARATION = [
  ["Training", "Aptitude Test Series - Round 3", "Placement Cell", daysAgo(45), 142],
  ["MockInterview", "Mock Interviews - CSE", "Alumni panel", daysAgo(30), 68],
  ["Workshop", "Resume Clinic", "Career Services", daysAgo(21), 96],
  ["Seminar", "Life in a product company", "Alumni - Acme Technologies", daysAgo(12), 210],
];
for (const [kind, title, conductedBy, heldOn, attendance] of PREPARATION) {
  try {
    await call("POST", "/college/events", {
      token: college.token,
      body: { kind, title, conductedBy, heldOn, attendance, batchYear: 2026 },
    });
    console.log(`    ${title} (${attendance} attended)`);
  } catch (err) {
    console.log(`    ${title}: ${err.message}`);
  }
}

step(6, "Posting a placement notice");
try {
  await call("POST", "/announcements", {
    token: college.token,
    body: {
      title: "Placement season 2026 is open",
      body:
        "Registration for the 2026 season is now open. Companies confirmed so far " +
        "are listed on the public dashboard, and the preparation schedule runs " +
        "through the term.",
      audience: "public",
    },
  });
  console.log("    one public notice posted");
} catch (err) {
  console.log(`    notice: ${err.message}`);
}

let students = [];
if (FULL) {
  step(7, "Registering students against the roster");
  for (let i = 0; i < 5; i++) {
    const s = await account(`student${i + 1}@seed.local`);
    try {
      // The roster is already uploaded, so this matches and verifies at once.
      await call("POST", "/me/claim-roll-number", {
        token: s.token,
        body: {
          collegeAddress: college.address,
          rollNumber: roster[i].rollNumber,
          // One student below the cutoff, so the eligibility block is visible.
          cgpa: i === 4 ? 6.2 : 8.2 - i * 0.3,
        },
      });
    } catch (err) {
      if (!/already verified/.test(err.message)) throw err;
    }
    students.push(s);
  }
  console.log(`    ${students.length} students registered`);

  step(8, "Students fill in their resumes");
  const SKILLS = [
    ["React.js", "PostgreSQL", "Python", "Git"],
    ["Java", "Spring", "MySQL"],
    ["Python", "Pandas", "Machine Learning"],
    ["C++", "Data Structures", "Linux"],
    ["HTML", "CSS", "JavaScript"],
  ];
  const EXPERIENCE = [
    ["Backend Intern", "Nimbus Labs", "Built the billing API and its test suite."],
    ["Android Intern", "Rangeet", "Shipped two screens of the customer app."],
    ["Data Analyst Intern", "CivicData", "Cleaned and charted three years of survey data."],
    ["Teaching Assistant", "Department of CSE", "Ran the weekly Data Structures lab."],
    ["Web Intern", "Local NGO", "Rebuilt the donations page."],
  ];
  for (let i = 0; i < students.length; i++) {
    const s = students[i];
    try {
      await call("PUT", "/me/skills", { token: s.token, body: { skills: SKILLS[i] } });
      await call("PATCH", "/me/profile", {
        token: s.token,
        body: {
          headline: `Final-year CSE student - ${SKILLS[i][0]}`,
          about: "Looking for a role where I can keep building things end to end.",
          phone: `98765${String(43210 + i)}`,
          githubUrl: `https://github.com/seed-student-${i + 1}`,
        },
      });
      const [title, subtitle, description] = EXPERIENCE[i];
      await call("POST", "/me/resume/experience", {
        token: s.token,
        body: { title, subtitle, description, startedOn: "Jun 2025", endedOn: "Aug 2025" },
      });
      await call("POST", "/me/resume/project", {
        token: s.token,
        body: {
          title: `${SKILLS[i][0]} project`,
          subtitle: "Personal",
          description: "A small project built to learn the stack properly.",
          url: `https://github.com/seed-student-${i + 1}/project`,
        },
      });
    } catch (err) {
      console.log(`    student ${i + 1}: ${err.message}`);
    }
  }
  console.log("    5 resumes with skills, an internship and a project each");

  step(9, "Posting a drive and hosting it");
  const now = Math.floor(Date.now() / 1000);
  const posted = await call("POST", "/drives", {
    token: company.token,
    body: {
      collegeAddress: college.address,
      roleTitle: "Software Engineer",
      annualPackage: 650000,
      minCgpa: 7,
      batchYear: 2026,
      applicationDeadline: now + 7 * 86400,
      driveDate: now + 14 * 86400,
      ipfsHash: "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG",
    },
  });
  await call("POST", `/college/drives/${posted.driveId}/approve`, { token: college.token });
  console.log(`    drive #${posted.driveId} is live`);

  step(10, "Four students apply; the fifth is blocked by the CGPA cutoff");
  await waitFor("the drive to reach the mirror", async () => {
    const open = await call("GET", "/drives/open", { token: students[0].token });
    return open.drives.some((d) => d.id === posted.driveId);
  });
  for (const s of students.slice(0, 4)) {
    try {
      await call("POST", `/drives/${posted.driveId}/apply`, { token: s.token });
    } catch (err) {
      if (!/already applied/.test(err.message)) throw err;
    }
  }
  console.log("    4 applied, 1 ineligible (CGPA 6.20 against a 7.00 cutoff)");

  step(11, "The company runs part of its funnel");
  await call("POST", `/drives/${posted.driveId}/application-count`, { token: company.token });
  const stage = (student, s, label = "") =>
    call("POST", `/outcomes/${posted.driveId}/stage`, {
      token: company.token,
      body: { studentAddress: student.address, stage: s, label },
    });
  for (const s of students.slice(0, 4)) await stage(s, "Shortlisted", "Screening");
  for (const s of students.slice(0, 2)) await stage(s, "Interview", "Tech Round");
  await stage(students[0], "Offered", "Final");
  console.log("    4 shortlisted, 2 interviewed, 1 offered — awaiting the student's answer");

  step(12, "The company posts a notice about its drive");
  try {
    await call("POST", "/announcements", {
      token: company.token,
      body: {
        driveId: posted.driveId,
        title: "Interview day - what to bring",
        body: "Two printed copies of your resume and a photo ID. Reporting time 9:30am.",
      },
    });
    console.log("    posted");
  } catch (err) {
    console.log(`    notice: ${err.message}`);
  }
}

// --- summary -----------------------------------------------------------------

printSummary("Seeded.");
db.close();
process.exit(0);

function printSummary(headline) {
console.log(`\n${"=".repeat(64)}`);
console.log(`${headline} Sign in at http://localhost:5173 with:\n`);
console.log(`  Admin     ${config.adminUsername} / your ADMIN_PASSWORD   — at /admin`);
console.log(`  College   ${COLLEGE_LOGIN_EMAIL.padEnd(22)} ${PASSWORD}`);
console.log(`  Company   company@seed.local     ${PASSWORD}`);
if (FULL) {
  for (let i = 0; i < 5; i++) {
    console.log(`  Student   student${i + 1}@seed.local    ${PASSWORD}${i === 4 ? "   (below the CGPA cutoff)" : ""}`);
  }
  console.log("\nStudent 1 has an offer waiting — sign in as them to accept it and");
  console.log("watch the placement figure move on the public dashboard.");
} else {
  console.log("\nRun `npm run seed:full` to also create students, a drive and a part-run funnel.");
}
console.log(`\nPublic dashboard (no sign-in): http://localhost:5173/public`);
console.log(`${"=".repeat(64)}\n`);
}
