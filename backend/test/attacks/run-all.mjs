/**
 * Runs every live attack suite in sequence and prints one verdict.
 *
 * These are NOT unit tests and deliberately aren't part of `npm test`: they
 * drive the real HTTP API against a running stack and write real transactions
 * to the chain. `npm test` must stay runnable with nothing else switched on.
 *
 * Requires all three services up (see TEST_PLAN.md Part 0) and an admin
 * account named `sarthak`.
 *
 *   npm run test:attacks
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.API_URL || "http://127.0.0.1:4000";

const SUITES = [
  ["e2e.mjs", "Full cross-role journey — signup to public dashboard"],
  ["flow2-attack.mjs", "Flow 2 — claiming an identity"],
  ["flow3-attack.mjs", "Flow 3 — getting verified"],
  ["flow4-attack.mjs", "Flow 4 — a college's placement cell"],
  ["flow5-attack.mjs", "Flow 5 — a company hiring"],
  ["flow7-attack.mjs", "Flow 7 — the public surface"],
];

function run(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(HERE, file)], { stdio: "inherit" });
    child.on("close", (code) => resolve(code === 0));
  });
}

// Fail early and clearly rather than with a wall of ECONNREFUSED.
try {
  const res = await fetch(`${BASE}/admin/health`, { signal: AbortSignal.timeout(5000) });
  const body = await res.json();
  if (body.status !== "ok") throw new Error(JSON.stringify(body));
  console.log(`Stack is up — chain at block ${body.blockNumber}\n`);
} catch (err) {
  console.error(
    `Cannot reach the backend at ${BASE}.\n` +
      `Start the stack first (see TEST_PLAN.md Part 0):\n` +
      `  1. npx hardhat node          (repo root)\n` +
      `  2. npm run deploy:local      (repo root)\n` +
      `  3. npm run dev               (backend)\n\n` +
      `Underlying error: ${err.message}`
  );
  process.exit(1);
}

const results = [];
for (const [file, description] of SUITES) {
  console.log(`\n${"=".repeat(70)}\n${description}\n${"=".repeat(70)}`);
  results.push([description, await run(file)]);
}

console.log(`\n${"=".repeat(70)}\nSUMMARY\n${"=".repeat(70)}`);
for (const [description, ok] of results) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${description}`);
}

const failed = results.filter(([, ok]) => !ok).length;
console.log(failed === 0 ? "\nAll suites passed.\n" : `\n${failed} suite(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
