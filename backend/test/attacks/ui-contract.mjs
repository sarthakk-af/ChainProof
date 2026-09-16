/**
 * Screen contracts — every field the dashboards actually read.
 *
 * A frontend build passing proves the JSX compiles, not that
 * `facets.courses.map` has anything to map over. This drives the same endpoints
 * the screens do and asserts the exact fields they destructure, so a response
 * shape that quietly changes fails here rather than as a blank panel nobody
 * notices until a demo.
 *
 * It found a real one on its first run: a student's profile kept the college it
 * was first written under, so a re-verified student vanished from the directory
 * and the talent pool with no error anywhere.
 *
 * Requires a seeded database — run `npm run seed -- --full` first.
 */
const BASE = "http://127.0.0.1:4000";
const PASSWORD = "SeedPass123";
let failures = 0;

function check(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${detail ? "  -- " + detail : ""}`);
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
  try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
}

async function login(email) {
  const r = await call("POST", "/auth/login", { body: { email, password: PASSWORD } });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.token;
}

const student = await login("student1@seed.local");
const student2 = await login("student2@seed.local");
const company = await login("company@seed.local");

// The college login email is whatever the admin last set; find it via the admin.
const adminLogin = await call("POST", "/admin/auth/login", {
  body: { username: "admin", password: process.env.ADMIN_PASSWORD || "AdminPass123" },
});
const adminToken = adminLogin.data?.token;

console.log("\n=== Student: resume screen ===");
{
  const sections = await call("GET", "/me/resume-sections", { token: student });
  const s = sections.data?.sections?.[0];
  check("resume-sections has the fields the form renders",
    !!s?.key && !!s?.label && !!s?.titleLabel && !!s?.subtitleLabel,
    JSON.stringify(s));

  const resume = await call("GET", "/me/resume", { token: student });
  check("resume returns every section as an array",
    ["experience", "project", "education", "certification", "achievement"].every(
      (k) => Array.isArray(resume.data?.resume?.[k])
    ),
    Object.keys(resume.data?.resume || {}).join(","));
  check("and the skill list", Array.isArray(resume.data?.skills), JSON.stringify(resume.data?.skills));

  const item = resume.data?.resume?.experience?.[0];
  check("an entry carries what the row renders",
    !!item?.id && !!item?.title && "subtitle" in item && "startedOn" in item && "url" in item,
    JSON.stringify(item));

  const added = await call("POST", "/me/resume/achievement", {
    token: student, body: { title: "UI contract check" },
  });
  check("adding an entry returns the saved item", added.status === 201 && !!added.data?.item?.id,
    `${added.status}`);
  const edited = await call("PATCH", `/me/resume/item/${added.data?.item?.id}`, {
    token: student, body: { title: "UI contract check (edited)" },
  });
  check("editing returns the updated item",
    edited.status === 200 && edited.data?.item?.title === "UI contract check (edited)",
    JSON.stringify(edited.data?.item?.title));
  const removed = await call("DELETE", `/me/resume/item/${added.data?.item?.id}`, { token: student });
  check("deleting answers cleanly", removed.status === 200 && removed.data?.deleted === true,
    String(removed.status));
}

console.log("\n=== Student: classmate lookup ===");
{
  const me = await call("GET", "/me", { token: student });
  const roll = me.data?.profile?.rollNumber;
  const hit = await call("POST", "/students/lookup", {
    token: student2, body: { rollNumber: roll, email: "student1@seed.local" },
  });
  check("a classmate is found by roll number and email", hit.status === 200, `${hit.status} ${hit.data?.error || ""}`);
  check("and the card has what it renders",
    !!hit.data?.student?.fullName && Array.isArray(hit.data?.student?.skills) && !!hit.data?.student?.resume,
    JSON.stringify(Object.keys(hit.data?.student || {})));
}

console.log("\n=== Student: notices ===");
{
  const feed = await call("GET", "/announcements", { token: student });
  check("the feed loads", feed.status === 200 && Array.isArray(feed.data?.announcements), String(feed.status));
  const n = feed.data?.announcements?.[0];
  check("a notice carries author, audience and timestamps",
    !!n?.title && !!n?.authorName && !!n?.audience && typeof n?.createdAt === "number",
    JSON.stringify(n && { t: n.title, a: n.authorName, au: n.audience }));
}

console.log("\n=== Company: talent pool ===");
{
  const facets = await call("GET", "/talent/facets", { token: company });
  check("facets give the filter options",
    Array.isArray(facets.data?.courses) && Array.isArray(facets.data?.batches) && Array.isArray(facets.data?.skills),
    JSON.stringify({ c: facets.data?.courses?.length, b: facets.data?.batches?.length, s: facets.data?.skills?.length }));
  check("each skill option has a label and a count",
    facets.data?.skills?.every((s) => s.skill && s.display && typeof s.students === "number"),
    JSON.stringify(facets.data?.skills?.[0]));

  const pool = await call("GET", "/talent", { token: company });
  const card = pool.data?.students?.[0];
  check("a card has what the list renders",
    !!card?.rollNumber && "cgpa" in card && "placed" in card && Array.isArray(card?.skills),
    JSON.stringify(card));
  check("and nothing it must not",
    !("fullName" in (card || {})) && !("email" in (card || {})) && !("phone" in (card || {})),
    JSON.stringify(Object.keys(card || {})));

  const detail = await call("GET", `/talent/${card?.rollNumber}`, { token: company });
  check("the detail view has links, resume and a contact verdict",
    !!detail.data?.student?.links && !!detail.data?.student?.resume &&
      typeof detail.data?.student?.contactUnlocked === "boolean" &&
      !!detail.data?.student?.contactUnlockedBy,
    JSON.stringify({ unlocked: detail.data?.student?.contactUnlocked }));
}

console.log("\n=== College: preparation ===");
{
  const overview = await call("GET", "/admin/overview", { token: adminToken });
  const collegeAddress = overview.data?.college?.address;

  const prep = await call("GET", `/public/colleges/${collegeAddress}/preparation`);
  check("the public preparation view loads",
    prep.status === 200 && Array.isArray(prep.data?.events) && !!prep.data?.summary,
    String(prep.status));
  check("the summary has the three figures the page shows",
    typeof prep.data?.summary?.standing === "number" &&
      typeof prep.data?.summary?.attendances === "number" &&
      Array.isArray(prep.data?.summary?.byKind),
    JSON.stringify(prep.data?.summary));
  const e = prep.data?.events?.[0];
  check("an event carries what the row renders",
    !!e?.title && !!e?.kind && !!e?.conductedBy && typeof e?.heldOn === "number" &&
      typeof e?.attendance === "number" && typeof e?.cancelled === "boolean",
    JSON.stringify(e && { t: e.title, k: e.kind }));

  const notices = await call("GET", `/public/colleges/${collegeAddress}/announcements`);
  check("public notices load", notices.status === 200 && Array.isArray(notices.data?.announcements),
    String(notices.data?.announcements?.length));
}

console.log("\n=== Admin: accounts ===");
{
  const accounts = await call("GET", "/admin/accounts", { token: adminToken });
  const a = accounts.data?.accounts?.[0];
  check("accounts carry name, role, status and login",
    !!a?.name && !!a?.role && !!a?.status && "email" in a,
    JSON.stringify(a && { n: a.name, r: a.role, s: a.status }));

  const kinds = await call("GET", "/college/events/kinds", { token: adminToken });
  check("the kinds route is college-only", kinds.status === 401 || kinds.status === 403, String(kinds.status));

  const actions = await call("GET", "/admin/actions", { token: adminToken });
  check("the action log loads", actions.status === 200 && Array.isArray(actions.data?.actions),
    String(actions.data?.actions?.length));
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}\n`);
process.exit(failures === 0 ? 0 : 1);
