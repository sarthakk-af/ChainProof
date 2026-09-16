import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The sync cursor is a single watermark meaning "every block up to here is
 * mirrored". Everything the public dashboard reports comes from that mirror,
 * so if the watermark ever passes a block that wasn't actually mirrored, the
 * published numbers are quietly wrong and nothing says so.
 *
 * That was the bug these tests exist for. A failed event handler only logged;
 * the next successful event — necessarily from a later block — moved the
 * cursor straight past the gap. Backfill resumes from the cursor, so a restart
 * skipped the failed event too. One transient RPC error during a getActor read
 * could permanently lose an approval.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, "test-indexer-cursor.sqlite");

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

const { safeCursor } = await import("../src/indexer.js");
const { db } = await import("../src/db.js");

// Left behind, this file collides with the next run and produces a failure that
// looks like a real regression. Cleaning up is what keeps a green suite
// meaningful.
after(() => {
  db.close();
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const file = TEST_DB_PATH + suffix;
    if (fs.existsSync(file)) fs.rmSync(file);
  }
});

test("with nothing failing, the cursor advances normally", () => {
  assert.equal(safeCursor(100, new Set()), 100);
});

test("the cursor is held below the earliest failed block", () => {
  // The exact bug: an event at 100 failed, a later one at 105 succeeded.
  // Advancing to 105 would strand block 100 forever, because backfill only
  // ever resumes from the cursor.
  assert.equal(safeCursor(105, new Set([100])), 99);
});

test("the earliest failure wins when several are outstanding", () => {
  assert.equal(safeCursor(200, new Set([150, 100, 180])), 99);
});

test("a failure ahead of the cursor doesn't drag it backwards", () => {
  // Block 300 failed but we're only confirming up to 100 — the watermark
  // should stay at 100, not jump forward to 299.
  assert.equal(safeCursor(100, new Set([300])), 100);
});

test("recovering the failed block releases the cursor", () => {
  const failed = new Set([100]);
  assert.equal(safeCursor(105, failed), 99);
  failed.delete(100);
  assert.equal(safeCursor(105, failed), 105);
});

test("a failure at the very block being confirmed still holds", () => {
  assert.equal(safeCursor(100, new Set([100])), 99);
});
