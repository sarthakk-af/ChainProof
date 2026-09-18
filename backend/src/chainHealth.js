/**
 * chainHealth.js — notices when the blockchain this backend was started
 * against is no longer the one it is talking to.
 *
 * Restarting a local Hardhat node wipes it: no contracts, no history, no
 * wallet balances. The backend kept serving anyway, so every on-chain action
 * failed with ethers' "could not coalesce error", and the app looked broken in
 * ways that pointed nowhere near the cause. This checks for it and says so.
 *
 * A reset can't be repaired from inside the process: the contract addresses
 * are read from the deployment manifest once, at start-up. So the answer is
 * always the same — deploy again, then restart the backend.
 */

import { provider } from "./chain.js";
import { deployment, config } from "./config.js";
import { getLastSyncedBlock, getDeploymentFingerprint } from "./db/connection.js";

const FIX =
  "Run `npm run deploy:local` from the project root, then restart the backend.";

/** Names of manifest contracts that have no code on the chain. */
export async function findMissingContracts() {
  const entries = Object.entries(deployment.contracts);
  const codes = await Promise.all(entries.map(([, c]) => provider.getCode(c.address)));
  return entries.filter((_, i) => codes[i] === "0x").map(([name]) => name);
}

/**
 * Returns `{ message, lasting }` describing what's wrong, or null when the
 * chain looks right. `lasting` is false for an unreachable node, which may
 * just be a moment's hiccup; a wiped chain stays wiped. Never throws.
 */
export async function checkChain() {
  let head;
  try {
    head = await provider.getBlockNumber();
  } catch {
    return {
      message: `The blockchain at ${config.rpcUrl} isn't reachable. Start it with \`npx hardhat node\`.`,
      lasting: false,
    };
  }

  const missing = await findMissingContracts().catch(() => null);
  if (missing === null) return null;
  if (missing.length > 0) {
    return {
      message: `The contracts aren't deployed on the blockchain at ${config.rpcUrl} (missing: ${missing.join(", ")}). It was probably restarted. ${FIX}`,
      lasting: true,
    };
  }

  // Same addresses, but less history than we've already read: the node was
  // restarted and redeployed while this process kept running. Only meaningful
  // for the deployment the stored cursor belongs to — a new manifest resets
  // the cursor when the indexer starts (indexer.js's resetIfRedeployed).
  const synced = getLastSyncedBlock();
  if (getDeploymentFingerprint() === deployment.deployedAt && head < synced) {
    return {
      message: `The blockchain was restarted while the backend was running (it is at block ${head}; the backend had read up to block ${synced}). ${FIX}`,
      lasting: true,
    };
  }

  return null;
}

let problem = null;

/** The current problem's message, or null. Read by the request gate and /health. */
export function chainProblem() {
  return problem?.message ?? null;
}

/**
 * Re-checks every `intervalMs`. A wiped chain stays reported once found — the
 * process can't recover without a restart, and a problem that vanished when
 * the new chain happened to pass the old block height would hide it. An
 * unreachable node clears again once it answers.
 */
export function watchChain(intervalMs = 15_000) {
  const timer = setInterval(async () => {
    if (problem?.lasting) return;
    const found = await checkChain();
    if (found && found.message !== problem?.message) console.error(`\n[chain] ${found.message}\n`);
    problem = found;
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}
