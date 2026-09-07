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

export const deployment = await loadDeployment();
