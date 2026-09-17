import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

/**
 * Cohort sizes — the denominator of every placement percentage.
 *
 * The public page tells parents when a college has revised a cohort's size,
 * because shrinking the denominator is the easiest way to inflate a placement
 * rate. That warning is only worth showing if it is never shown falsely, which
 * is what these tests protect: the same chain event arriving twice, and a size
 * re-declared unchanged, must not count as revisions.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, "test-batches.sqlite");

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

const { db, upsertBatch, listBatches } = await import("../src/db.js");

after(() => {
  db.close();
  cleanupDbFiles();
});

let n = 0;
function freshCollege() {
  n++;
  return ethers.Wallet.createRandom().address;
}

function declare(college, strength, previousStrength, blockNumber) {
  upsertBatch({
    collegeAddress: college,
    courseCode: "CSE",
    batchYear: 2026,
    strength,
    previousStrength,
    blockNumber,
  });
  return listBatches(college)[0];
}

test("a first declaration is not a revision", () => {
  const college = freshCollege();
  const row = declare(college, 180, 0, 10);
  assert.equal(row.strength, 180);
  assert.equal(row.revision_count, 0);
});

test("the same event arriving twice is counted once", () => {
  // In normal operation the route syncs its own receipt and the live listener
  // then delivers the same event again.
  const college = freshCollege();
  declare(college, 180, 0, 10);
  const row = declare(college, 180, 0, 10);
  assert.equal(row.revision_count, 0, "a duplicate delivery must not read as a revision");
});

test("a genuine change is counted once, even if delivered twice", () => {
  const college = freshCollege();
  declare(college, 180, 0, 10);
  declare(college, 60, 180, 11);
  const row = declare(college, 60, 180, 11);
  assert.equal(row.strength, 60);
  assert.equal(row.previous_strength, 180);
  assert.equal(row.revision_count, 1);
});

test("re-declaring the same size is not a revision", () => {
  // Telling parents a cohort was "revised" when nothing changed is exactly the
  // false signal this figure exists to avoid.
  const college = freshCollege();
  declare(college, 180, 0, 10);
  const row = declare(college, 180, 180, 12);
  assert.equal(row.revision_count, 0);
  assert.equal(row.strength, 180);
});

test("an older event never overwrites a newer one's revision count", () => {
  // Reconciliation can replay an older block after a newer one has landed.
  const college = freshCollege();
  declare(college, 180, 0, 10);
  declare(college, 60, 180, 12);
  const row = declare(college, 120, 180, 11);
  assert.equal(row.revision_count, 1, "a replayed older event must not count");
  assert.equal(row.strength, 60, "nor may it overwrite the newer size");
});
