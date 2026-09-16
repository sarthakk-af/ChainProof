import { ethers } from "ethers";
import {
  provider,
  actorRegistryRead,
  placementDriveRead,
  driveOutcomesRead,
  preparationLogRead,
} from "./chain.js";
import { deployment } from "./config.js";
import {
  getLastSyncedBlock,
  setLastSyncedBlock,
  getDeploymentFingerprint,
  resetMirrorForNewDeployment,
  upsertActor,
  upsertBatch,
  upsertDrive,
  setDriveStatus,
  setDriveApplicationCount,
  addOutcome,
  setOfferResponse,
  setPlacement,
  upsertPreparationEvent,
  setPreparationCancelled,
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

/**
 * The declared size of a cohort — the denominator of every placement figure.
 * The event carries the previous value as well as the new one, so a revision is
 * mirrored as a revision rather than looking like a first declaration.
 */
function syncBatchStrength(args, log) {
  const [college, courseCode, batchYear, previousStrength, newStrength] = args;
  upsertBatch({
    collegeAddress: college,
    courseCode,
    batchYear: Number(batchYear),
    strength: Number(newStrength),
    previousStrength: Number(previousStrength),
    blockNumber: log.blockNumber,
  });
}

/** A company posting its own opening. Every field is the company's own. */
function syncDrivePosted(args, log) {
  const [
    driveId,
    company,
    college,
    roleTitle,
    annualPackage,
    minCgpaScaled,
    batchYear,
    applicationDeadline,
    driveDate,
    ipfsHash,
  ] = args;
  upsertDrive({
    id: Number(driveId),
    companyAddress: company,
    collegeAddress: college,
    roleTitle,
    annualPackage: Number(annualPackage),
    minCgpaScaled: Number(minCgpaScaled),
    batchYear: Number(batchYear),
    applicationDeadline: Number(applicationDeadline),
    driveDate: Number(driveDate),
    ipfsHash,
    // DrivePosted is always immediately followed by a DriveStatusChanged to
    // Proposed in the same transaction; this is just the value until it lands.
    status: 1,
    postedAt: Number(log.blockNumber),
    blockNumber: log.blockNumber,
  });
}

function syncDriveStatus(args, log) {
  const [driveId, , newStatus] = args;
  setDriveStatus(Number(driveId), Number(newStatus), log.blockNumber);
}

function syncApplicationCount(args, log) {
  const [driveId, , , newCount] = args;
  setDriveApplicationCount(Number(driveId), Number(newCount), log.blockNumber);
}

/**
 * One stage a company recorded for one student. Appended, never updated — a
 * withdrawn offer is a new row superseding an old one, which is the whole
 * reason this is worth putting on a chain.
 */
function syncStageRecorded(args, log) {
  const [driveId, student, , previousStage, newStage, label, ipfsHash, timestamp] = args;
  addOutcome({
    driveId: Number(driveId),
    studentAddress: student,
    stage: Number(newStage),
    previousStage: Number(previousStage),
    label: label || null,
    ipfsHash: ipfsHash || null,
    timestamp: Number(timestamp),
    blockNumber: log.blockNumber,
  });
}

function syncOfferAnswered(args, log) {
  const [driveId, student, response, timestamp] = args;
  setOfferResponse({
    driveId: Number(driveId),
    studentAddress: student,
    response: Number(response),
    timestamp: Number(timestamp),
    blockNumber: log.blockNumber,
  });
}

/**
 * Placement, in whichever direction it moved.
 * @dev Mirrored from the contract's own answer rather than recomputed here.
 *      Deriving it locally would be a second implementation of the same rule,
 *      and two implementations of one rule eventually disagree — at which point
 *      the published figure stops matching the chain it claims to come from.
 */
function syncPlacementChanged(args, log) {
  const [student, college, batchYear, placed] = args;
  setPlacement({
    studentAddress: student,
    collegeAddress: college,
    batchYear: Number(batchYear),
    placed: Boolean(placed),
    blockNumber: log.blockNumber,
  });
}

/**
 * One preparation activity the college recorded.
 * @dev `recordedAt` comes from the block, not from the event: the claimed date
 *      is the college's word and the block timestamp is not, and the difference
 *      between the two is exactly what makes this record worth reading.
 */
async function syncPreparationRecorded(args, log) {
  const [eventId, college, kind, title, heldOn, attendance, batchYear] = args;
  const onChain = await preparationLogRead.getPreparationEvent(eventId);
  const block = await log.getBlock();
  upsertPreparationEvent({
    id: Number(eventId),
    collegeAddress: college,
    kind: Number(kind),
    title,
    // conductedBy and the document pointer aren't in the event — only the
    // fields a listener needs to render a feed are indexed there — so they come
    // from the contract's own copy.
    conductedBy: onChain.conductedBy,
    heldOn: Number(heldOn),
    attendance: Number(attendance),
    batchYear: Number(batchYear),
    ipfsHash: onChain.ipfsHash || null,
    recordedAt: Number(block?.timestamp ?? Math.floor(Date.now() / 1000)),
    blockNumber: log.blockNumber,
  });
}

/** The college stating a recorded activity did not happen. Never a delete. */
function syncPreparationCancelled(args, log) {
  const [eventId, , reason] = args;
  setPreparationCancelled(Number(eventId), reason || null, log.blockNumber);
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
  {
    contract: actorRegistryRead,
    eventName: "ActorSuspended",
    handle: (args, log) => syncActor(args[0], log.blockNumber),
  },
  {
    contract: actorRegistryRead,
    eventName: "ActorReinstated",
    handle: (args, log) => syncActor(args[0], log.blockNumber),
  },
  { contract: actorRegistryRead, eventName: "BatchStrengthRecorded", handle: syncBatchStrength },
  { contract: placementDriveRead, eventName: "DrivePosted", handle: syncDrivePosted },
  { contract: placementDriveRead, eventName: "DriveStatusChanged", handle: syncDriveStatus },
  {
    contract: placementDriveRead,
    eventName: "ApplicationCountRecorded",
    handle: syncApplicationCount,
  },
  { contract: driveOutcomesRead, eventName: "StageRecorded", handle: syncStageRecorded },
  { contract: driveOutcomesRead, eventName: "OfferAnswered", handle: syncOfferAnswered },
  { contract: driveOutcomesRead, eventName: "PlacementChanged", handle: syncPlacementChanged },
  {
    contract: preparationLogRead,
    eventName: "PreparationRecorded",
    handle: syncPreparationRecorded,
  },
  {
    contract: preparationLogRead,
    eventName: "PreparationCancelled",
    handle: syncPreparationCancelled,
  },
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

  // Reaching here means every event in the range was mirrored, so any block in
  // it that was previously held back is resolved. Done before moving the
  // cursor, so a gap can never be forgotten while the watermark moves past it.
  const repaired = pendingSyncFailures().filter((b) => b >= fromBlock && b <= toBlock);
  for (const block of repaired) clearSyncFailure(block);
  if (repaired.length > 0) {
    console.log(`[indexer] recovered ${repaired.length} previously failed block(s): ${repaired.join(", ")}`);
  }

  setLastSyncedBlock(safeCursor(toBlock));
  console.log(`[indexer] processed ${entries.length} event(s), now synced to block ${getLastSyncedBlock()}`);
}

/**
 * Blocks whose events failed to sync and haven't been recovered.
 *
 * The sync cursor is a single "everything up to here is mirrored" watermark,
 * so it must never pass a block that isn't actually mirrored. Previously a
 * failed handler only logged, and the next *successful* event — inevitably
 * from a later block — advanced the cursor straight past the gap. The failed
 * event was then unreachable: backfill resumes from the cursor, so a restart
 * skipped it too. One transient RPC error during a `getActor` read was enough
 * to lose an approval permanently, with the mirror showing stale data and
 * nothing anywhere saying so.
 */
const unsyncedBlocks = new Set();

/** The furthest the cursor may advance, given what is known to be missing. */
export function safeCursor(candidateBlock, failed = unsyncedBlocks) {
  if (failed.size === 0) return candidateBlock;
  return Math.min(candidateBlock, Math.min(...failed) - 1);
}

export function recordSyncFailure(blockNumber, failed = unsyncedBlocks) {
  failed.add(blockNumber);
}

export function clearSyncFailure(blockNumber, failed = unsyncedBlocks) {
  failed.delete(blockNumber);
}

/** Exposed for tests and for a health check that wants to report sync gaps. */
export function pendingSyncFailures() {
  return [...unsyncedBlocks].sort((a, b) => a - b);
}

/** Keep the cache in sync with new events as they arrive while the process runs. */
export function startLiveSync({ reconcileIntervalMs = 60000 } = {}) {
  for (const watcher of WATCHERS) {
    watcher.contract.on(watcher.eventName, async (...args) => {
      const payload = args[args.length - 1];
      const eventArgs = args.slice(0, -1);
      const blockNumber = payload.log.blockNumber;
      try {
        await watcher.handle(eventArgs, payload.log);
        clearSyncFailure(blockNumber);
        // Only ever forwards, and never past a known gap.
        const target = safeCursor(blockNumber);
        if (target > getLastSyncedBlock()) setLastSyncedBlock(target);
      } catch (err) {
        recordSyncFailure(blockNumber);
        console.error(
          `[indexer] failed to sync ${watcher.eventName} at block ${blockNumber} — ` +
            `holding the sync cursor below it until reconciliation succeeds:`,
          err
        );
      }
    });
  }

  // A listener can stop delivering without erroring — a dropped subscription,
  // a provider that quietly stops polling. Nothing would notice, and the
  // mirror would drift from the chain while the process looked healthy.
  // Re-running the cursor-based backfill periodically repairs that, and any
  // block held back above, without duplicating anything: every write is an
  // upsert keyed by the on-chain id.
  const timer = setInterval(() => {
    backfill().catch((err) => console.error("[indexer] reconciliation failed:", err));
  }, reconcileIntervalMs);
  // Don't hold the process open purely for this.
  if (typeof timer.unref === "function") timer.unref();

  console.log(
    `[indexer] live event sync active (reconciling every ${Math.round(reconcileIntervalMs / 1000)}s)`
  );
  return timer;
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

// Re-exported so action routes (register / post drive / record stage) can update
// the cache immediately after their own transaction confirms, instead of racing
// the live listener.
export {
  syncActor,
  syncBatchStrength,
  syncDrivePosted,
  syncDriveStatus,
  syncApplicationCount,
  syncStageRecorded,
  syncOfferAnswered,
  syncPlacementChanged,
  syncPreparationRecorded,
  syncPreparationCancelled,
};
