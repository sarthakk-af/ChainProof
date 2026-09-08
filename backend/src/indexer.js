import { ethers } from "ethers";
import {
  provider,
  actorRegistryRead,
  credentialIssuerRead,
  placementTrackerRead,
} from "./chain.js";
import {
  getLastSyncedBlock,
  setLastSyncedBlock,
  upsertActor,
  upsertCredential,
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
  });
}

// CredentialIssued and VisitAnnounced are append-only logs — no follow-up
// chain read needed, the event args are the full record.
//
// NOTE: CredentialIssuer.sol's `issueCorrection` (added for the append-only
// correction feature) emits this same event with two extra trailing fields
// (isCorrection, supersedesId) that this positional destructure doesn't read.
// The backend doesn't expose a route to call `issueCorrection` yet (deferred
// scope), so this can't happen through normal app usage today — but if it's
// ever triggered directly on-chain, the credential still gets indexed here,
// just without the correction relationship or the original's `superseded`
// flag being captured. Revisit this (and the `credentials` table schema)
// when corrections are exposed through the API.
function syncCredentialIssued(args, log) {
  const [student, issuer, id, ipfsHash, credType, timestamp] = args;
  upsertCredential({
    id: Number(id),
    studentAddress: student,
    issuerAddress: issuer,
    ipfsHash,
    credType: Number(credType),
    timestamp: Number(timestamp),
    blockNumber: log.blockNumber,
  });
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
