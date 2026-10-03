import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");

/**
 * One configuration file for the whole project: `.env` at the repository root.
 *
 * The contracts and the backend used to have a file each, and they drifted:
 * the key that deployed the contracts (and so became their verifier) was not
 * the key the backend signed admin actions with, so a deployment to a public
 * network would have left the backend unable to approve the college at all.
 * Values already set in the environment win, so tests and hosting platforms
 * can still supply their own.
 */
dotenv.config({ path: path.resolve(BACKEND_ROOT, "../.env") });
if (fs.existsSync(path.resolve(BACKEND_ROOT, ".env"))) {
  console.warn(
    "[config] backend/.env is no longer read — settings live in .env at the project root. " +
      "Move anything you still need there and delete backend/.env."
  );
}

/**
 * Hardhat's account #0. `npm run deploy:local` deploys with it, which makes it
 * the contracts' verifier on a local chain — so the backend uses it there
 * without being told. Its key is printed in Hardhat's own documentation, which
 * is exactly why it is only ever used against a local node (see the guard at
 * the bottom of this file).
 */
const HARDHAT_ACCOUNT_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const NETWORK = (process.env.NETWORK || "localhost").trim().toLowerCase();

/** The chain to talk to: an explicit RPC_URL, or the one NETWORK names. */
function resolveRpcUrl() {
  if (process.env.RPC_URL) return process.env.RPC_URL;
  if (NETWORK === "localhost") return process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545";
  if (NETWORK === "amoy") {
    if (!process.env.AMOY_RPC_URL) throw new Error("NETWORK is amoy but AMOY_RPC_URL is not set in .env.");
    return process.env.AMOY_RPC_URL;
  }
  throw new Error(`NETWORK must be "localhost" or "amoy" (got "${NETWORK}").`);
}

function withHexPrefix(key) {
  const trimmed = String(key).trim();
  return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
}

/**
 * The key the backend signs verifier actions with — always the key that
 * deployed the contracts, since deploying is what makes an address the
 * verifier. Locally that is Hardhat's account #0; on a public network it is
 * DEPLOYER_PRIVATE_KEY. VERIFIER_PRIVATE_KEY overrides both, for the day the
 * verifier role is handed to a different key.
 */
function resolveVerifierKey(rpcUrl) {
  if (process.env.VERIFIER_PRIVATE_KEY) return withHexPrefix(process.env.VERIFIER_PRIVATE_KEY);
  if (isLocalRpc(rpcUrl)) return HARDHAT_ACCOUNT_0;
  if (process.env.DEPLOYER_PRIVATE_KEY) return withHexPrefix(process.env.DEPLOYER_PRIVATE_KEY);
  throw new Error(
    "No verifier key: set DEPLOYER_PRIVATE_KEY in .env to the key the contracts were deployed with."
  );
}

const RPC_URL = resolveRpcUrl();
const VERIFIER_KEY = resolveVerifierKey(RPC_URL);

// The deploy script (scripts/deploy.js at repo root) writes contract addresses/ABIs
// here on every deployment. Reusing it directly avoids keeping a second copy of
// addresses/ABIs in sync by hand.
// DEPLOYMENT_MANIFEST points a second, throwaway stack at its own deployment
// (for example a sandbox on another port) without touching the real one.
const DEPLOYMENT_MANIFEST_PATH = process.env.DEPLOYMENT_MANIFEST
  ? path.resolve(process.env.DEPLOYMENT_MANIFEST)
  : path.resolve(__dirname, "../../frontend/src/contracts/deployment.js");

async function loadDeployment() {
  let manifest;
  try {
    // Node's ESM loader requires a file:// URL for absolute paths on Windows —
    // a raw "D:\..." path is rejected even though it works fine with require().
    manifest = await import(pathToFileURL(DEPLOYMENT_MANIFEST_PATH).href);
  } catch (err) {
    // Not deployed yet is the common case, but this could also be a genuinely
    // corrupted/syntax-broken manifest — keep the real cause visible instead
    // of assuming one specific reason.
    throw new Error(
      `Could not load deployment manifest at ${DEPLOYMENT_MANIFEST_PATH}. ` +
        `Deploy the contracts first: npx hardhat run scripts/deploy.js --network localhost\n` +
        `Underlying error: ${err.message}`,
      { cause: err }
    );
  }

  const { DEPLOYMENT } = manifest;
  if (!DEPLOYMENT) {
    throw new Error(
      "Deployment manifest found but exports no DEPLOYMENT object — redeploy the contracts."
    );
  }
  return DEPLOYMENT;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  network: NETWORK,
  rpcUrl: RPC_URL,
  verifierPrivateKey: VERIFIER_KEY,
  // The platform owner's login, created at first start (see server.js).
  adminUsername: (process.env.ADMIN_USERNAME || "admin").trim().toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || "",
  port: Number(process.env.PORT || 4000),
  // Relative to backend/, wherever the process was started from — the setting
  // now lives at the project root, and "./data" must not start meaning a
  // different folder depending on which directory `npm start` ran in.
  dbPath: path.resolve(BACKEND_ROOT, process.env.DB_PATH || "data/chainproof.sqlite"),
  jwtSecret: requireEnv("JWT_SECRET"),
  walletEncryptionKey: requireEnv("WALLET_ENCRYPTION_KEY"),
  // The wallet that funds every user's gas. Defaults to the verifier, so a
  // deployment needs one funded key, not two.
  treasuryPrivateKey: process.env.TREASURY_PRIVATE_KEY
    ? withHexPrefix(process.env.TREASURY_PRIVATE_KEY)
    : VERIFIER_KEY,
  // 1.0 is free on a local chain, where each test account holds 10,000. On a
  // real network it is a real balance per signup, so unless set explicitly the
  // drip there is small: ample for a student's handful of transactions on
  // Polygon, and topped up automatically if a wallet runs low (treasury.js).
  walletGasDripEth: process.env.WALLET_GAS_DRIP_ETH || (isLocalRpc(RPC_URL) ? "1.0" : "0.05"),
  frontendOrigin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",
  // Optional, not required — password reset just logs a clear error at
  // request time if this isn't configured, rather than refusing to start
  // the whole server over one unconfigured feature.
  brevoApiKey: process.env.BREVO_API_KEY || "",
  emailFromAddress: process.env.EMAIL_FROM_ADDRESS || "",
  emailFromName: process.env.EMAIL_FROM_NAME || "ChainProof",
};

/**
 * Refuses to start against a real network using development credentials.
 *
 * Locally, the verifier and treasury are Hardhat's default accounts — that's
 * correct and convenient, and those keys are published in Hardhat's own
 * documentation. Point RPC_URL at a testnet or mainnet without changing them
 * and the same keys become a catastrophe: the verifier decides which colleges
 * and companies are legitimate, and the treasury funds every user's wallet.
 * Anyone in the world can derive both from a mnemonic printed in a README.
 *
 * Nothing checked for this before. The app would have started cleanly, looked
 * entirely normal, and been wholly controlled by strangers.
 */
const HARDHAT_TEST_MNEMONIC =
  "test test test test test test test test test test test junk";

function isLocalRpc(url) {
  try {
    const { hostname } = new URL(url);
    return ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(hostname);
  } catch {
    return false;
  }
}

async function wellKnownDevKeys() {
  const { HDNodeWallet, Mnemonic } = await import("ethers");
  const mnemonic = Mnemonic.fromPhrase(HARDHAT_TEST_MNEMONIC);
  const keys = new Set();
  for (let i = 0; i < 20; i++) {
    keys.add(
      HDNodeWallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/${i}`).privateKey.toLowerCase()
    );
  }
  return keys;
}

async function assertProductionCredentials() {
  if (isLocalRpc(config.rpcUrl)) return;

  const problems = [];
  const devKeys = await wellKnownDevKeys();

  if (devKeys.has(String(config.verifierPrivateKey).toLowerCase())) {
    problems.push(
      "VERIFIER_PRIVATE_KEY is a well-known Hardhat development key. The verifier " +
        "approves every college and company — anyone could derive this key and " +
        "approve themselves."
    );
  }
  if (devKeys.has(String(config.treasuryPrivateKey).toLowerCase())) {
    problems.push(
      "TREASURY_PRIVATE_KEY is a well-known Hardhat development key. It funds every " +
        "user wallet — anyone could derive it and drain the balance."
    );
  }
  if (!config.jwtSecret || config.jwtSecret.length < 32 || /^test|secret$|changeme/i.test(config.jwtSecret)) {
    problems.push(
      "JWT_SECRET is weak or a placeholder. It signs every session, including admin " +
        "sessions; it must be a long random value."
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(String(config.walletEncryptionKey || ""))) {
    problems.push(
      "WALLET_ENCRYPTION_KEY must be 64 hex characters (32 bytes). It encrypts every " +
        "custodial private key held by this service."
    );
  }

  if (problems.length > 0) {
    const NL = String.fromCharCode(10);
    const lines = [
      "Refusing to start against a non-local network (" + config.rpcUrl + ") with development credentials.",
      "",
      ...problems.map((p, i) => "  " + (i + 1) + ". " + p),
      "",
      "Generate fresh values before deploying:",
      "  JWT_SECRET / WALLET_ENCRYPTION_KEY:",
      "    node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      "  VERIFIER_PRIVATE_KEY / TREASURY_PRIVATE_KEY:",
      "    node -e \"console.log(require('ethers').Wallet.createRandom().privateKey)\"",
      "",
      "Set RPC_URL to a local node to run in development mode.",
    ];
    throw new Error(lines.join(NL));
  }
}

await assertProductionCredentials();

export const deployment = await loadDeployment();
