import { db } from "./connection.js";

/**
 * Addresses are stored and matched lowercased.
 *
 * Ethereum addresses are checksummed mixed-case, so the same address arrives in
 * two spellings depending on whether it came from a contract read, a request
 * body, or another table. Every table that references an actor already
 * lowercases — so leaving this one checksummed meant joins between them
 * silently matched nothing, and a query returned an empty result that looked
 * exactly like "there is no such actor".
 *
 * Same lesson as email normalisation: one convention, applied in the data
 * layer, so no call site has to remember.
 */
function normalizeAddress(address) {
  return String(address ?? "").toLowerCase();
}

export function upsertActor(actor) {
  // Deliberately does NOT touch rejection_reason — this is called from the
  // generic chain-event sync path (see indexer.js's syncActor), which fires
  // for ActorRegistered *and* ActorApproved *and* ActorRejected alike. The
  // reason is off-chain-only metadata with no on-chain equivalent, so a
  // generic "re-mirror whatever's on-chain" sync has no authority to touch
  // it — only an explicit action (rejecting, or a fresh registration) should.
  const row = { metadata: null, rejectionCount: 0, ...actor };
  row.address = normalizeAddress(row.address);
  row.college = row.college ? normalizeAddress(row.college) : null;
  db.prepare(
    `INSERT INTO actors (address, role, status, name, metadata, college, registered_at_block, updated_at_block, rejection_count)
     VALUES (@address, @role, @status, @name, @metadata, @college, @registeredAtBlock, @updatedAtBlock, @rejectionCount)
     ON CONFLICT(address) DO UPDATE SET
       role = excluded.role,
       status = excluded.status,
       name = excluded.name,
       metadata = excluded.metadata,
       college = excluded.college,
       updated_at_block = excluded.updated_at_block,
       rejection_count = excluded.rejection_count`
  ).run(row);
}

/** Called specifically when a genuine new registration/resubmission succeeds. */
export function clearRejectionReason(address) {
  db.prepare("UPDATE actors SET rejection_reason = NULL WHERE address = ?").run(normalizeAddress(address));
}

/**
 * Records whether the website given at registration actually responded to a
 * live request — off-chain-only evidence for the admin queue, computed once
 * right after registration (see routes/me.js). Deliberately not touched by
 * upsertActor's generic chain-event sync, same reasoning as rejection_reason:
 * it has no on-chain equivalent, so a passive "re-mirror the chain" pass has
 * no authority to overwrite it.
 */
export function setWebsiteReachable(address, reachable) {
  db.prepare("UPDATE actors SET website_reachable = ? WHERE address = ?").run(
    reachable === null ? null : reachable ? 1 : 0,
    normalizeAddress(address)
  );
}

/**
 * A College/Company's self-reported accreditation/registration ID — the one
 * concrete, externally-checkable thing an admin has to weigh a Pending
 * institution against, beyond a name and a website (see routes/me.js's
 * /register and registrationNumber.js). Off-chain only: it's input to a
 * one-time approval decision, not a durable fact worth writing on-chain.
 */
export function setRegistrationNumber(address, value) {
  db.prepare("UPDATE actors SET registration_number = ? WHERE address = ?").run(value, normalizeAddress(address));
}

export function getActor(address) {
  return db.prepare("SELECT * FROM actors WHERE address = ?").get(normalizeAddress(address));
}

export function listActors({ role, status, college } = {}) {
  const clauses = [];
  const params = {};
  if (role !== undefined) {
    clauses.push("role = @role");
    params.role = role;
  }
  if (status !== undefined) {
    clauses.push("status = @status");
    params.status = status;
  }
  if (college !== undefined) {
    clauses.push("college = @college");
    params.college = normalizeAddress(college);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db
    .prepare(`SELECT * FROM actors ${where} ORDER BY registered_at_block ASC`)
    .all(params);
}
