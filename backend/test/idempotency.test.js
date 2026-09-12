import { test } from "node:test";
import assert from "node:assert/strict";

const {
  withIdempotency,
  fingerprintPayload,
  IdempotencyPendingError,
  IdempotencyKeyConflictError,
} = await import("../src/idempotency.js");

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
