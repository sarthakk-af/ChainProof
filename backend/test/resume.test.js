import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

/**
 * The resume — the half of a profile a student writes themselves.
 *
 * Two properties worth protecting here, and they pull in opposite directions:
 *
 *   - a student may write anything about themselves, because nothing here is
 *     verified and a false claim surfaces at the interview. Validation exists to
 *     stop malformed data and hostile links, not to police claims;
 *   - a student may write only about *themselves*. Every mutation is scoped by
 *     owner in the same SQL statement that performs it, so an id belonging to
 *     someone else changes nothing rather than changing their resume.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, "test-resume.sqlite");

function cleanupDbFiles() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const file = TEST_DB_PATH + suffix;
    // Retries because Windows can hold a just-closed SQLite file for a moment,
    // which otherwise fails the run with EBUSY after every test has passed.
    if (fs.existsSync(file)) fs.rmSync(file, { force: true, maxRetries: 10, retryDelay: 50 });
  }
}
cleanupDbFiles();

process.env.RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
process.env.VERIFIER_PRIVATE_KEY =
  process.env.VERIFIER_PRIVATE_KEY ||
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
process.env.JWT_SECRET = "test-jwt-secret";
process.env.WALLET_ENCRYPTION_KEY =
  "236d277256c4ac74368580b5be214189ace6dff26eb4e5efe448dbf1c2a1158c";
process.env.DB_PATH = TEST_DB_PATH;

const {
  db,
  upsertProfile,
  addResumeItem,
  getResumeItem,
  updateResumeItem,
  deleteResumeItem,
  reorderResumeItems,
  listResumeItems,
  setSkills,
  listSkills,
  skillVocabulary,
} = await import("../src/db.js");
const { parseResumeItem, parseSkills, normalizeSkill, MAX_ITEMS_PER_KIND } = await import(
  "../src/resume.js"
);
const { parseField } = await import("../src/studentProfile.js");

const college = ethers.Wallet.createRandom().address.toLowerCase();
const asha = ethers.Wallet.createRandom().address.toLowerCase();
const rahul = ethers.Wallet.createRandom().address.toLowerCase();

before(() => {
  upsertProfile(asha, college, { roll_number: "21CE1041", full_name: "Asha", batch_year: 2026 });
  upsertProfile(rahul, college, { roll_number: "21CE1042", full_name: "Rahul", batch_year: 2026 });
});

after(() => {
  db.close();
  cleanupDbFiles();
});

// --- what may be written -----------------------------------------------------

test("a well-formed entry is accepted with its fields normalised", () => {
  const parsed = parseResumeItem("experience", {
    title: "  Backend   Intern ",
    subtitle: "Acme Ltd",
    startedOn: "Jun 2025",
    endedOn: "Aug 2025",
    description: "Built the billing API.\r\n\r\n\r\nWrote the tests too.",
    url: "https://acme.example/interns/asha",
  });

  assert.equal(parsed.values.title, "Backend Intern");
  // Paragraphs keep their line breaks — collapsing them would run a whole
  // description into one line — but a run of blank lines is squeezed to one.
  assert.equal(parsed.values.description, "Built the billing API.\n\nWrote the tests too.");
});

test("an entry with no title is refused, saying which field", () => {
  const parsed = parseResumeItem("project", { description: "no title" });
  assert.match(parsed.error, /Project is required/);
});

test("an unknown section is refused", () => {
  assert.match(parseResumeItem("nonsense", { title: "x" }).error, /Unknown section/);
});

test("a javascript: link is refused", () => {
  // These render as anchors someone will click. Restricting the scheme here is
  // what stops the frontend having to remember to check.
  const parsed = parseResumeItem("project", {
    title: "Portfolio",
    url: "javascript:alert(document.cookie)",
  });
  assert.match(parsed.error, /full URL starting with https/);
});

test("a description longer than the bound is refused", () => {
  const parsed = parseResumeItem("project", { title: "Big", description: "x".repeat(1001) });
  assert.match(parsed.error, /1000 bytes or fewer/);
});

// --- ownership ---------------------------------------------------------------

test("an entry belongs to the student who created it", () => {
  const { values } = parseResumeItem("project", { title: "Chain explorer" });
  const { item } = addResumeItem(asha, values);
  assert.equal(item.title, "Chain explorer");
  assert.equal(getResumeItem(item.id).address, asha);
});

test("another student cannot edit it", () => {
  const { values } = parseResumeItem("project", { title: "Mine" });
  const { item } = addResumeItem(asha, values);

  const hostile = parseResumeItem("project", { title: "Actually mine" }).values;
  // Scoped by owner in the UPDATE itself, so this changes nothing rather than
  // relying on a check somewhere above it that could be skipped.
  assert.equal(updateResumeItem(item.id, rahul, hostile), false);
  assert.equal(getResumeItem(item.id).title, "Mine");
});

test("another student cannot delete it", () => {
  const { values } = parseResumeItem("achievement", { title: "Rank 3" });
  const { item } = addResumeItem(asha, values);

  assert.equal(deleteResumeItem(item.id, rahul), false);
  assert.ok(getResumeItem(item.id));
  assert.equal(deleteResumeItem(item.id, asha), true);
  assert.equal(getResumeItem(item.id), undefined);
});

test("reordering ignores ids belonging to someone else", () => {
  const mine = addResumeItem(asha, parseResumeItem("certification", { title: "A" }).values).item;
  const theirs = addResumeItem(rahul, parseResumeItem("certification", { title: "B" }).values).item;

  reorderResumeItems(asha, "certification", [theirs.id, mine.id]);

  // Rahul's entry keeps the position it had; only Asha's own was touched.
  assert.equal(getResumeItem(theirs.id).position, 0);
});

test("a section stops accepting entries at its cap", () => {
  const filler = ethers.Wallet.createRandom().address.toLowerCase();
  upsertProfile(filler, college, { roll_number: "21CE9000" });

  for (let i = 0; i < MAX_ITEMS_PER_KIND; i++) {
    const { values } = parseResumeItem("project", { title: `Project ${i}` });
    assert.ok(addResumeItem(filler, values).item, `entry ${i} should be accepted`);
  }
  const overflow = addResumeItem(filler, parseResumeItem("project", { title: "One more" }).values);
  assert.match(overflow.error, /at most/);
});

test("listing returns every section, empty ones included", () => {
  const grouped = listResumeItems(rahul);
  // The form renders from this, so a missing key would mean a missing section
  // rather than an empty one.
  assert.deepEqual(Object.keys(grouped).sort(), [
    "achievement",
    "certification",
    "education",
    "experience",
    "project",
  ]);
});

// --- skills ------------------------------------------------------------------

test("spellings of one skill collapse to a single match key", () => {
  // A recruiter filtering for "React.js" must find the student who typed
  // "react js", or the filter is decorative.
  const keys = ["React.js", "react js", "  REACT-JS "].map((s) => normalizeSkill(s).skill);
  assert.equal(new Set(keys).size, 1, `expected one key, got ${keys}`);
});

test("what the student typed is what gets shown", () => {
  setSkills(asha, parseSkills(["React.js", "PostgreSQL"]).values);
  assert.deepEqual(
    listSkills(asha).map((s) => s.display),
    ["PostgreSQL", "React.js"]
  );
});

test("setting skills replaces the list rather than adding to it", () => {
  // A merge would leave no way to remove one.
  setSkills(asha, parseSkills(["Python"]).values);
  assert.deepEqual(
    listSkills(asha).map((s) => s.display),
    ["Python"]
  );
});

test("a duplicate in one submission is not an error", () => {
  const parsed = parseSkills(["Java", "java", "JAVA"]);
  assert.equal(parsed.values.length, 1);
  assert.equal(parsed.values[0].display, "Java");
});

test("an absurd number of skills is refused", () => {
  const parsed = parseSkills(Array.from({ length: 41 }, (_, i) => `skill${i}`));
  assert.match(parsed.error, /at most 40/);
});

test("the vocabulary counts students, so a filter offers what exists", () => {
  setSkills(asha, parseSkills(["Python", "SQL"]).values);
  setSkills(rahul, parseSkills(["Python"]).values);

  const vocab = skillVocabulary(college);
  const python = vocab.find((v) => v.skill === "python");
  assert.equal(python.students, 2);
  assert.equal(vocab.find((v) => v.skill === "sql").students, 1);
  // Most common first, so the useful filters are the ones on screen.
  assert.equal(vocab[0].skill, "python");
});

// --- the profile fields these sit beside -------------------------------------

test("a profile link keeps its case", () => {
  // Course codes are upper-cased so "cse" and "CSE" are one course. Doing that
  // to a URL turns a working link into a 404.
  const parsed = parseField("github_url", "https://github.com/Sarthak/MyRepo");
  assert.equal(parsed.value, "https://github.com/Sarthak/MyRepo");
});

test("an about section keeps its paragraphs", () => {
  const parsed = parseField("about", "First line.\n\nSecond line.");
  assert.equal(parsed.value, "First line.\n\nSecond line.");
});
