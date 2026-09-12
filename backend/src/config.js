import "dotenv/config";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The deploy script (scripts/deploy.js at repo root) writes contract addresses/ABIs
// here on every deployment. Reusing it directly avoids keeping a second copy of
// addresses/ABIs in sync by hand.
const DEPLOYMENT_MANIFEST_PATH = path.resolve(
  __dirname,
  "../../frontend/src/contracts/deployment.js"
);

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
  rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8545",
  verifierPrivateKey: requireEnv("VERIFIER_PRIVATE_KEY"),
  adminApiKey: requireEnv("ADMIN_API_KEY"),
  port: Number(process.env.PORT || 4000),
  dbPath: process.env.DB_PATH || "./data/chainproof.sqlite",
  jwtSecret: requireEnv("JWT_SECRET"),
  walletEncryptionKey: requireEnv("WALLET_ENCRYPTION_KEY"),
  treasuryPrivateKey: process.env.TREASURY_PRIVATE_KEY || process.env.VERIFIER_PRIVATE_KEY,
  walletGasDripEth: process.env.WALLET_GAS_DRIP_ETH || "1.0",
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
