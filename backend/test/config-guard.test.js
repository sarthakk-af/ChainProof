import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import crypto from "node:crypto";

/**
 * The guard that refuses to start a real network with development keys.
 *
 * Run in child processes because config.js evaluates its checks at import
 * time — once this process has imported it, the outcome is fixed.
 *
 * Why this matters more than most tests here: locally, the verifier and
 * treasury are Hardhat's default accounts, which is correct and convenient.
 * Those keys are published in Hardhat's own documentation. Carry the same
 * .env to a testnet and the verifier — which decides who is a legitimate
 * college or company — is controlled by anyone who can read a README.
 * Nothing checked for this before; the app would have started cleanly and
 * looked entirely normal.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");
const CONFIG = path.join(BACKEND_ROOT, "src", "config.js").replace(/\\/g, "/");

const HARDHAT_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const randomKey = () => ethers.Wallet.createRandom().privateKey;
const randomHex = () => crypto.randomBytes(32).toString("hex");

/** Imports config.js in a child process with the given env; returns its outcome. */
function startWith(env) {
  const result = spawnSync(
    process.execPath,
    ["-e", `import('file:///${CONFIG}').then(()=>console.log('STARTED')).catch(e=>{console.log('REFUSED');console.error(e.message);})`],
    {
      cwd: BACKEND_ROOT,
      env: {
        ...process.env,
        ...env,
      },
      encoding: "utf8",
      timeout: 60000,
    }
  );
  return {
    started: (result.stdout || "").includes("STARTED"),
    message: (result.stderr || "") + (result.stdout || ""),
  };
}

const GOOD = {
  VERIFIER_PRIVATE_KEY: randomKey(),
  TREASURY_PRIVATE_KEY: randomKey(),
  JWT_SECRET: randomHex(),
  WALLET_ENCRYPTION_KEY: randomHex(),
};

test("a local node still starts with Hardhat's development keys", () => {
  // This must keep working — it is how the project is developed.
  const res = startWith({
    RPC_URL: "http://127.0.0.1:8545",
    VERIFIER_PRIVATE_KEY: HARDHAT_KEY,
    TREASURY_PRIVATE_KEY: HARDHAT_KEY,
    JWT_SECRET: "dev-secret",
    WALLET_ENCRYPTION_KEY: randomHex(),
  });
  assert.equal(res.started, true, res.message);
});

test("a remote RPC with a Hardhat verifier key is refused", () => {
  const res = startWith({
    RPC_URL: "https://rpc-amoy.polygon.technology",
    ...GOOD,
    VERIFIER_PRIVATE_KEY: HARDHAT_KEY,
  });
  assert.equal(res.started, false, "should have refused to start");
  assert.match(res.message, /VERIFIER_PRIVATE_KEY/);
});

test("a remote RPC with a Hardhat treasury key is refused", () => {
  const res = startWith({
    RPC_URL: "https://rpc-amoy.polygon.technology",
    ...GOOD,
    TREASURY_PRIVATE_KEY: HARDHAT_KEY,
  });
  assert.equal(res.started, false);
  assert.match(res.message, /TREASURY_PRIVATE_KEY/);
});

test("later Hardhat accounts are caught too, not just the first", () => {
  // The guard derives the whole default set, so account #5 is no safer than #0.
  const mnemonic = ethers.Mnemonic.fromPhrase(
    "test test test test test test test test test test test junk"
  );
  const fifth = ethers.HDNodeWallet.fromMnemonic(mnemonic, "m/44'/60'/0'/0/5").privateKey;
  const res = startWith({
    RPC_URL: "https://rpc-amoy.polygon.technology",
    ...GOOD,
    VERIFIER_PRIVATE_KEY: fifth,
  });
  assert.equal(res.started, false);
  assert.match(res.message, /VERIFIER_PRIVATE_KEY/);
});

test("a remote RPC with a weak JWT secret is refused", () => {
  for (const weak of ["changeme", "test-jwt-secret", "short"]) {
    const res = startWith({
      RPC_URL: "https://rpc-amoy.polygon.technology",
      ...GOOD,
      JWT_SECRET: weak,
    });
    assert.equal(res.started, false, `"${weak}" should have been refused`);
    assert.match(res.message, /JWT_SECRET/);
  }
});

test("a remote RPC with a malformed wallet encryption key is refused", () => {
  const res = startWith({
    RPC_URL: "https://rpc-amoy.polygon.technology",
    ...GOOD,
    WALLET_ENCRYPTION_KEY: "too-short",
  });
  assert.equal(res.started, false);
  assert.match(res.message, /WALLET_ENCRYPTION_KEY/);
});

test("a remote RPC with genuinely fresh credentials is allowed", () => {
  // The guard must not block a legitimate deployment — a false positive here
  // would be just as damaging, because it trains you to disable the check.
  const res = startWith({
    RPC_URL: "https://rpc-amoy.polygon.technology",
    ...GOOD,
  });
  assert.equal(res.started, true, res.message);
});
