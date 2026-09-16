import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

/**
 * The profile field list and the eligibility rules derived from it.
 *
 * Two things are being protected here. First, that the list stays a single
 * declaration: everything else is generated from it, so adding a field is one
 * edit rather than five that drift apart. Second, that a CGPA cutoff is an
 * exact comparison — a student turned away at exactly the cutoff, by a rounding
 * artefact, would have no way to tell that had happened.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, "test-profile.sqlite");
for (const suffix of ["", "-journal", "-wal", "-shm"]) {
  const file = TEST_DB_PATH + suffix;
  if (fs.existsSync(file)) fs.rmSync(file);
}

process.env.RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
process.env.VERIFIER_PRIVATE_KEY =
  process.env.VERIFIER_PRIVATE_KEY ||
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
process.env.ADMIN_API_KEY = "test-admin-key";
process.env.JWT_SECRET = "test-jwt-secret";
process.env.WALLET_ENCRYPTION_KEY =
  "236d277256c4ac74368580b5be214189ace6dff26eb4e5efe448dbf1c2a1158c";
process.env.DB_PATH = TEST_DB_PATH;

const {
  STUDENT_FIELDS,
  ROSTER_FIELDS,
  SELF_FIELDS,
  parseField,
  parseFields,
  serializeProfile,
  describeFields,
  publicKey,
} = await import("../src/studentProfile.js");
const { checkEligibility, db } = await import("../src/db.js");

after(() => {
  db.close();
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const file = TEST_DB_PATH + suffix;
    if (fs.existsSync(file)) fs.rmSync(file);
  }
});

// --- the field declaration ---------------------------------------------------

test("roster fields and self fields together are the whole list", () => {
  assert.equal(ROSTER_FIELDS.length + SELF_FIELDS.length, STUDENT_FIELDS.length);
  // What the college supplies establishes identity; what the student supplies
  // does not. That split is the reason a student can't rename themselves.
  assert.deepEqual(ROSTER_FIELDS.map((f) => f.column), [
    "roll_number",
    "full_name",
    "course_code",
    "batch_year",
  ]);
});

test("a field's public name can differ from its column", () => {
  // cgpa_scaled is stored x100 so cutoff comparisons are exact. A client should
  // never have to know that — it sends and receives a plain 7.85.
  const cgpa = STUDENT_FIELDS.find((f) => f.column === "cgpa_scaled");
  assert.equal(publicKey(cgpa), "cgpa");
  assert.ok(describeFields().some((f) => f.key === "cgpa"));
  assert.ok(!describeFields().some((f) => f.key === "cgpaScaled"));
});

test("the frontend can render the form without hard-coding it", () => {
  for (const field of describeFields()) {
    assert.ok(field.key, "every field needs a key");
    assert.ok(field.label, "every field needs a label");
    assert.equal(typeof field.required, "boolean");
  }
});

// --- parsing -----------------------------------------------------------------

test("text fields are trimmed, and upper-cased where a pattern expects it", () => {
  assert.equal(parseField("roll_number", "  21ce1042  ").value, "21CE1042");
  // "cse" and "CSE" must be one course, not two — same reasoning as
  // registration numbers.
  assert.equal(parseField("course_code", "cse").value, "CSE");
});

test("a malformed value is refused with the reason, not just rejected", () => {
  const result = parseField("roll_number", "bad!!");
  assert.ok(result.error);
  assert.match(result.error, /Roll number/);
  assert.match(result.error, /Letters, digits/);
});

test("a required field cannot be blank; an optional one may be", () => {
  assert.ok(parseField("full_name", "").error);
  assert.equal(parseField("phone", "").value, null);
  assert.equal(parseField("cgpa_scaled", "").value, null);
});

test("CGPA is stored scaled by 100 and returned unscaled", () => {
  assert.equal(parseField("cgpa_scaled", "7.85").value, 785);
  assert.equal(parseField("cgpa_scaled", "10").value, 1000);
  assert.equal(parseField("cgpa_scaled", 0).value, 0);
  assert.equal(serializeProfile({ cgpa_scaled: 785 }).cgpa, 7.85);
});

test("out-of-range values are refused in human units", () => {
  const tooHigh = parseField("cgpa_scaled", "11");
  assert.match(tooHigh.error, /at most 10/);
  const tooEarly = parseField("batch_year", "1990");
  assert.match(tooEarly.error, /at least 2000/);
});

test("parseFields accepts the public key", () => {
  const result = parseFields(SELF_FIELDS, { cgpa: "8.10", phone: "+91 98765 43210" });
  assert.equal(result.values.cgpa_scaled, 810);
  assert.equal(result.values.phone, "+91 98765 43210");
});

// --- eligibility -------------------------------------------------------------

const drive = (overrides = {}) => ({ batch_year: 2026, min_cgpa_scaled: 700, ...overrides });

test("a student at exactly the cutoff is eligible", () => {
  // The reason CGPA is an integer. As a float, 7.00 >= 7.00 is a coin toss at
  // the boundary, and the student refused by it would never know why.
  const result = checkEligibility({ batch_year: 2026, cgpa_scaled: 700 }, drive());
  assert.equal(result.eligible, true);
});

test("a student one hundredth below the cutoff is refused, with the number", () => {
  const result = checkEligibility({ batch_year: 2026, cgpa_scaled: 699 }, drive());
  assert.equal(result.eligible, false);
  // The specific cutoff, not "not eligible" — the criteria were published
  // on-chain before applications opened, so the student is owed the figure
  // they actually missed.
  assert.match(result.reason, /7\.00/);
  assert.match(result.reason, /6\.99/);
});

test("the wrong batch is refused and says which batch the drive is for", () => {
  const result = checkEligibility({ batch_year: 2025, cgpa_scaled: 900 }, drive());
  assert.equal(result.eligible, false);
  assert.match(result.reason, /2026/);
});

test("a missing CGPA is refused with what to do about it", () => {
  const result = checkEligibility({ batch_year: 2026, cgpa_scaled: null }, drive());
  assert.equal(result.eligible, false);
  assert.match(result.reason, /Add your CGPA/);
});

test("a drive with no cutoff accepts a student who hasn't entered a CGPA", () => {
  const result = checkEligibility({ batch_year: 2026, cgpa_scaled: null }, drive({ min_cgpa_scaled: 0 }));
  assert.equal(result.eligible, true);
});

test("no profile at all is refused", () => {
  const result = checkEligibility(null, drive());
  assert.equal(result.eligible, false);
  assert.match(result.reason, /Complete your profile/);
});
