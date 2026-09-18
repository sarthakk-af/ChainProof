import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Its own database file: these records live in SQLite now (a crash between the
// chain write and the response is the case the module exists for, and an
// in-process Map forgot every key exactly then), so the tests must not write
// into the real one.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, "test-idempotency.sqlite");
function cleanupDbFiles() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const file = TEST_DB_PATH + suffix;
    if (fs.existsSync(file)) fs.rmSync(file, { force: true, maxRetries: 10, retryDelay: 50 });
  }
}
cleanupDbFiles();
process.env.DB_PATH = TEST_DB_PATH;
process.env.RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
process.env.VERIFIER_PRIVATE_KEY =
  process.env.VERIFIER_PRIVATE_KEY ||
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
process.env.JWT_SECRET = "test-jwt-secret";
process.env.WALLET_ENCRYPTION_KEY =
  "236d277256c4ac74368580b5be214189ace6dff26eb4e5efe448dbf1c2a1158c";

const {
  withIdempotency,
  fingerprintPayload,
  IdempotencyPendingError,
  IdempotencyKeyConflictError,
  IdempotencyUnresolvedError,
} = await import("../src/idempotency.js");
const { db } = await import("../src/db/connection.js");

after(() => {
  db.close();
  cleanupDbFiles();
});

/**
 * These exist because of one specific failure: a key reused with different
 * inputs used to return the earlier call's receipt and a 201 — telling the
 * caller its request had succeeded while nothing at all was written. A silent
 * false success is the worst outcome available here, because nobody has any
 * reason to go and check.
 */

const fp = (...parts) => fingerprintPayload(parts);

test("a genuine retry runs the work only once", async () => {
  let runs = 0;
  const work = async () => {
    runs++;
    return "receipt-1";
  };
  const key = "retry-key";
  const print = fp("issue", "0xabc", 3, "QmHash");

  assert.equal(await withIdempotency(1, key, print, work), "receipt-1");
  assert.equal(await withIdempotency(1, key, print, work), "receipt-1");
  assert.equal(runs, 1, "the second call must not touch the chain again");
});

test("reusing a key with a different payload is refused, not replayed", async () => {
  const key = "reused-key";
  await withIdempotency(2, key, fp("issue", "0xStudentOne", 3, "QmHash"), async () => "receipt-one");

  await assert.rejects(
    () => withIdempotency(2, key, fp("issue", "0xStudentTwo", 3, "QmHash"), async () => "receipt-two"),
    IdempotencyKeyConflictError,
    "a different recipient under the same key must not silently return the first receipt"
  );
});

test("the same key belonging to a different user is unrelated", async () => {
  const key = "shared-key-name";
  const a = await withIdempotency(10, key, fp("issue", "0xA", 0, "QmA"), async () => "user-10");
  const b = await withIdempotency(11, key, fp("issue", "0xB", 0, "QmB"), async () => "user-11");
  assert.equal(a, "user-10");
  assert.equal(b, "user-11");
});

test("a failed attempt frees the key so a corrected retry can proceed", async () => {
  const key = "failing-key";
  const print = fp("issue", "0xabc", 3, "QmHash");

  await assert.rejects(
    () => withIdempotency(3, key, print, async () => { throw new Error("chain down"); }),
    /chain down/
  );

  // Nothing reached the chain, so the same key must work again.
  assert.equal(await withIdempotency(3, key, print, async () => "recovered"), "recovered");
});

test("a second call while the first is still in flight is told to wait", async () => {
  const key = "in-flight-key";
  const print = fp("issue", "0xabc", 3, "QmHash");

  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const first = withIdempotency(4, key, print, async () => { await blocked; return "done"; });

  await assert.rejects(
    () => withIdempotency(4, key, print, async () => "second"),
    IdempotencyPendingError
  );

  release();
  assert.equal(await first, "done");
});

test("no key means no memoization at all", async () => {
  let runs = 0;
  const work = async () => { runs++; return runs; };
  await withIdempotency(5, undefined, fp("x"), work);
  await withIdempotency(5, undefined, fp("x"), work);
  assert.equal(runs, 2, "opting out must stay opted out");
});

test("fingerprints track the values that matter", () => {
  assert.equal(fp("issue", "0xA", 3, "QmH"), fp("issue", "0xA", 3, "QmH"));
  assert.notEqual(fp("issue", "0xA", 3, "QmH"), fp("issue", "0xB", 3, "QmH"), "recipient");
  assert.notEqual(fp("issue", "0xA", 3, "QmH"), fp("issue", "0xA", 4, "QmH"), "credential type");
  assert.notEqual(fp("issue", "0xA", 3, "QmH"), fp("issue", "0xA", 3, "QmJ"), "document");
});

// --- a send that may have landed ---------------------------------------------

test("a failure after the send is not offered as a fresh start", async () => {
  // tx.wait() throws on a dropped connection or a replaced transaction, long
  // after the node accepted the transaction. The first version freed the key
  // here, so the retry sent a second one — the exact duplicate this module
  // exists to prevent.
  const key = "broadcast-then-lost";
  const print = fp("stage", "0xabc", 3, "QmHash");

  await assert.rejects(
    () =>
      withIdempotency(6, key, print, async ({ markBroadcast }) => {
        markBroadcast();
        throw new Error("connection dropped while waiting");
      }),
    /connection dropped/
  );

  let ranAgain = false;
  await assert.rejects(
    () =>
      withIdempotency(6, key, print, async () => {
        ranAgain = true;
        return "second attempt";
      }),
    IdempotencyUnresolvedError
  );
  assert.equal(ranAgain, false, "the retry must not reach the chain again");
});

test("the remembered answer is the response, so a replay needs no chain", async () => {
  const key = "replayed-answer";
  const print = fp("drive", "0xcollege", "SDE");
  const first = await withIdempotency(7, key, print, async ({ markBroadcast }) => {
    markBroadcast();
    return { txHash: "0xdeadbeef", driveId: 4 };
  });
  const replay = await withIdempotency(7, key, print, async () => {
    throw new Error("must not run");
  });
  assert.deepEqual(replay, first);
});

test("a record outlives the process that made it", async () => {
  // Written by "another process": the same rows this one reads.
  const key = "survives-restart";
  const print = fp("stage", "0xrestart", 1);
  db.prepare(
    `INSERT INTO idempotency_keys (store_key, fingerprint, status, result, broadcast, expires_at)
     VALUES (?, ?, 'done', ?, 1, ?)`
  ).run(`8:${key}`, print, JSON.stringify({ txHash: "0xearlier" }), Date.now() + 60000);

  const answer = await withIdempotency(8, key, print, async () => {
    throw new Error("must not run");
  });
  assert.deepEqual(answer, { txHash: "0xearlier" });
});
