import { ethers } from "ethers";
import {
  provider,
  actorRegistryRead,
  credentialIssuerRead,
  placementTrackerRead,
} from "./chain.js";
import { deployment } from "./config.js";
import {
  getLastSyncedBlock,
  setLastSyncedBlock,
  getDeploymentFingerprint,
  resetMirrorForNewDeployment,
  upsertActor,
  upsertCredential,
  markCredentialSuperseded,
  upsertVisit,
} from "./db.js";

/**
 * ActorRegistry events carry the actor's address as their first argument, so
 * they're handled by re-fetching the actor's current on-chain state rather
 * than trying to reconstruct it from partial event args — simpler and can't
 * drift out of sync.
 */
async function syncActor(address, blockNumber) {
  const actor = await actorRegistryRead.getActor(address);
  upsertActor({
    address,
    role: Number(actor.role),
    status: Number(actor.status),
    name: actor.name,
    metadata: actor.metadata || null,
    college: actor.college === ethers.ZeroAddress ? null : actor.college,
    registeredAtBlock: blockNumber,
    updatedAtBlock: blockNumber,
    rejectionCount: Number(actor.rejectionCount),
  });
}

// CredentialIssued and VisitAnnounced are append-only logs — no follow-up
// chain read needed, the event args are the full record. This same event
// covers both a fresh issueCredential and a follow-up issueCorrection —
// isCorrection/supersedesId tell them apart, and when it's a correction the
// original row is flagged superseded here too (never edited or removed).
function syncCredentialIssued(args, log) {
  const [student, issuer, id, ipfsHash, credType, timestamp, isCorrection, supersedesId] = args;
  upsertCredential({
    id: Number(id),
    studentAddress: student,
    issuerAddress: issuer,
    ipfsHash,
    credType: Number(credType),
    timestamp: Number(timestamp),
    blockNumber: log.blockNumber,
    isCorrection: isCorrection ? 1 : 0,
    supersedesId: isCorrection ? Number(supersedesId) : null,
  });
  if (isCorrection) markCredentialSuperseded(Number(supersedesId));
}

function syncVisitAnnounced(args, log) {
  const [college, id, companyName, ipfsHash, visitDate, timestamp] = args;
  upsertVisit({
    id: Number(id),
    collegeAddress: college,
    companyName,
    ipfsHash,
    visitDate: Number(visitDate),
    timestamp: Number(timestamp),
    blockNumber: log.blockNumber,
  });
}

/**
 * Every event this indexer mirrors into SQLite. Adding a new one is just
 * adding an entry here (plus a table + handle function if it's not covered
 * by an existing one) — the backfill/live-sync logic below is generic.
 */
const WATCHERS = [
  {
    contract: actorRegistryRead,
    eventName: "ActorRegistered",
    handle: (args, log) => syncActor(args[0], log.blockNumber),
  },
  {
    contract: actorRegistryRead,
    eventName: "ActorApproved",
    handle: (args, log) => syncActor(args[0], log.blockNumber),
  },
  {
    contract: actorRegistryRead,
    eventName: "ActorRejected",
    handle: (args, log) => syncActor(args[0], log.blockNumber),
  },
  { contract: credentialIssuerRead, eventName: "CredentialIssued", handle: syncCredentialIssued },
  { contract: placementTrackerRead, eventName: "VisitAnnounced", handle: syncVisitAnnounced },
];

/**
 * A restarted local Hardhat node redeploys to the same deterministic
 * addresses but wipes all on-chain history — `deployment.deployedAt` is
 * unique per actual deploy run, so it's what actually distinguishes "same
 * chain, keep resuming" from "fresh chain, the mirror is now stale."
 * Wiping on mismatch trades a slower first backfill after every restart for
 * never silently losing or misattributing data — the right trade for a
 * local dev/demo deployment.
 */
function resetIfRedeployed() {
  const currentFingerprint = deployment.deployedAt;
  const storedFingerprint = getDeploymentFingerprint();
  if (storedFingerprint === currentFingerprint) return;

  if (storedFingerprint) {
    console.log(
      `[indexer] detected a new deployment (was ${storedFingerprint}, now ${currentFingerprint}) — resetting the mirror DB`
    );
  }
  resetMirrorForNewDeployment(currentFingerprint);
}

/** Catch up on every relevant event since the last time the indexer ran. */
export async function backfill() {
  const fromBlock = getLastSyncedBlock() + 1;
  const toBlock = await provider.getBlockNumber();
  if (fromBlock > toBlock) {
    console.log(`[indexer] up to date at block ${toBlock}`);
    return;
  }

  console.log(`[indexer] backfilling blocks ${fromBlock}..${toBlock}`);

  const logsPerWatcher = await Promise.all(
    WATCHERS.map((w) =>
      w.contract.queryFilter(w.contract.filters[w.eventName](), fromBlock, toBlock)
    )
  );

  const entries = logsPerWatcher.flatMap((logs, i) =>
    logs.map((log) => ({ watcher: WATCHERS[i], log }))
  );
  entries.sort((a, b) => a.log.blockNumber - b.log.blockNumber || a.log.index - b.log.index);

  for (const { watcher, log } of entries) {
    await watcher.handle(log.args, log);
  }

  setLastSyncedBlock(toBlock);
  console.log(`[indexer] processed ${entries.length} event(s), now synced to block ${toBlock}`);
}

/** Keep the cache in sync with new events as they arrive while the process runs. */
export function startLiveSync() {
  for (const watcher of WATCHERS) {
    watcher.contract.on(watcher.eventName, async (...args) => {
      const payload = args[args.length - 1];
      const eventArgs = args.slice(0, -1);
      try {
        await watcher.handle(eventArgs, payload.log);
        setLastSyncedBlock(payload.log.blockNumber);
      } catch (err) {
        console.error(`[indexer] failed to sync ${watcher.eventName}:`, err);
      }
    });
  }
  console.log("[indexer] live event sync active");
}

export async function startIndexer() {
  resetIfRedeployed();
  await backfill();
  startLiveSync();
}

/**
 * Finds and decodes one named event from a transaction receipt. Used by action
 * routes to sync the cache immediately after their own transaction confirms,
 * instead of racing the live listener — mirrors the pattern already used by
 * the Phase 2 admin approve/reject routes for actor status.
 */
export function findEventInReceipt(contractRead, eventName, receipt) {
  for (const log of receipt.logs) {
    try {
      const parsed = contractRead.interface.parseLog(log);
      if (parsed && parsed.name === eventName) {
        return parsed.args;
      }
    } catch {
      // log belongs to a different contract's interface — ignore
    }
  }
  return null;
}

// Re-exported so action routes (register/issue/announce) can update the cache
// immediately after their own transaction confirms, instead of waiting on the
// live listener — mirrors the pattern already used by the Phase 2 admin routes.
export { syncActor, syncCredentialIssued, syncVisitAnnounced };
