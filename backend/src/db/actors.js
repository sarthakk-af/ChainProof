import { db } from "./connection.js";

export function upsertActor(actor) {
  // Deliberately does NOT touch rejection_reason — this is called from the
  // generic chain-event sync path (see indexer.js's syncActor), which fires
  // for ActorRegistered *and* ActorApproved *and* ActorRejected alike. The
  // reason is off-chain-only metadata with no on-chain equivalent, so a
  // generic "re-mirror whatever's on-chain" sync has no authority to touch
  // it — only an explicit action (rejecting, or a fresh registration) should.
  const row = { metadata: null, rejectionCount: 0, ...actor };
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

export function updateActorStatus(address, status, updatedAtBlock, rejectionReason = null) {
  db.prepare(
    "UPDATE actors SET status = ?, updated_at_block = ?, rejection_reason = ? WHERE address = ?"
  ).run(status, updatedAtBlock, rejectionReason, address);
}

/** Called specifically when a genuine new registration/resubmission succeeds. */
export function clearRejectionReason(address) {
  db.prepare("UPDATE actors SET rejection_reason = NULL WHERE address = ?").run(address);
}

export function getActor(address) {
  return db.prepare("SELECT * FROM actors WHERE address = ?").get(address);
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
    params.college = college;
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db
    .prepare(`SELECT * FROM actors ${where} ORDER BY registered_at_block ASC`)
    .all(params);
}
