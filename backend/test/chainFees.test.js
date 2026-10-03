import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The tip cap on transaction fees.
 *
 * Amoy's node suggested a 500+ gwei tip while blocks included 25-gwei ones;
 * taken at face value, every student action cost more than the gas each new
 * wallet is given. These run against a stand-in provider — no chain needed.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
process.env.JWT_SECRET = "test-jwt-secret";
process.env.WALLET_ENCRYPTION_KEY = "236d277256c4ac74368580b5be214189ace6dff26eb4e5efe448dbf1c2a1158c";
process.env.DB_PATH = path.join(__dirname, "test-chain-fees.sqlite");

const { capPriorityFee, waitUntilFinal } = await import("../src/chain.js");
const { ethers } = await import("ethers");

const gwei = (n) => ethers.parseUnits(String(n), "gwei");

/** A provider that suggests the given fees and reports the given base fee. */
function fakeProvider({ tip, maxFee, gasPrice = null, baseFee = gwei(1) }) {
  return {
    getFeeData: async () => new ethers.FeeData(gasPrice, maxFee, tip),
    getBlock: async () => ({ baseFeePerGas: baseFee }),
  };
}

test("an inflated suggested tip is cut to the cap", async () => {
  const p = capPriorityFee(fakeProvider({ tip: gwei(500), maxFee: gwei(502) }), gwei(50));
  const fee = await p.getFeeData();
  assert.equal(fee.maxPriorityFeePerGas, gwei(50));
});

test("the fee ceiling is recomputed from the capped tip, not left at the old one", async () => {
  // A node refuses a transaction the wallet can't cover at its ceiling, so a
  // ceiling still sized for a 500-gwei tip would fail exactly as before.
  const p = capPriorityFee(fakeProvider({ tip: gwei(500), maxFee: gwei(502), baseFee: gwei(1) }), gwei(50));
  const fee = await p.getFeeData();
  assert.equal(fee.maxFeePerGas, gwei(1) * 2n + gwei(50));
});

test("a suggestion already under the cap is left as it is", async () => {
  const p = capPriorityFee(fakeProvider({ tip: gwei(30), maxFee: gwei(32) }), gwei(50));
  const fee = await p.getFeeData();
  assert.equal(fee.maxPriorityFeePerGas, gwei(30));
});

test("a chain without EIP-1559 fees has its gas price capped instead", async () => {
  const p = capPriorityFee(fakeProvider({ tip: null, maxFee: null, gasPrice: gwei(400) }), gwei(50));
  const fee = await p.getFeeData();
  assert.equal(fee.gasPrice, gwei(50));
});

test("no cap leaves the provider untouched", async () => {
  const original = fakeProvider({ tip: gwei(500), maxFee: gwei(502) });
  const before = original.getFeeData;
  capPriorityFee(original, null);
  assert.equal(original.getFeeData, before);
});

// --- waiting for finality ----------------------------------------------------------

/** A network whose finalised block advances one step per poll. */
function fakeNetwork({ finalizedSteps, receiptBlocks }) {
  let poll = -1;
  return {
    // Each check of the finalised block is one poll.
    getBlock: async () => {
      poll++;
      return { number: finalizedSteps[Math.min(poll, finalizedSteps.length - 1)] };
    },
    getTransactionReceipt: async () => {
      const block = receiptBlocks[Math.min(poll, receiptBlocks.length - 1)];
      return block === null ? null : { hash: "0xabc", blockNumber: block };
    },
  };
}

test("waits until the transaction's block is final, then returns its final receipt", async () => {
  const net = fakeNetwork({ finalizedSteps: [95, 98, 100, 101], receiptBlocks: [100] });
  const final = await waitUntilFinal(net, { hash: "0xabc", blockNumber: 100 }, { pollMs: 1 });
  assert.equal(final.blockNumber, 100);
});

test("a transaction moved to a later block is followed there", async () => {
  // First seen in block 100, which the network discarded; it landed in 103.
  const net = fakeNetwork({ finalizedSteps: [100, 102, 104], receiptBlocks: [103, 103, 103] });
  const final = await waitUntilFinal(net, { hash: "0xabc", blockNumber: 100 }, { pollMs: 1 });
  assert.equal(final.blockNumber, 103);
});

test("a transaction the network dropped is reported, not treated as recorded", async () => {
  const net = fakeNetwork({ finalizedSteps: [100], receiptBlocks: [null] });
  await assert.rejects(
    waitUntilFinal(net, { hash: "0xabc", blockNumber: 100 }, { pollMs: 1 }),
    /dropped this transaction/
  );
});

test("a block that never becomes final times out with an honest message", async () => {
  const net = fakeNetwork({ finalizedSteps: [50], receiptBlocks: [100] });
  await assert.rejects(
    waitUntilFinal(net, { hash: "0xabc", blockNumber: 100 }, { pollMs: 1, timeoutMs: 20 }),
    /hasn't confirmed it as final yet/
  );
});
