import { db } from "./connection.js";

export function upsertActor(actor) {
  db.prepare(
    `INSERT INTO actors (address, role, status, name, college, registered_at_block, updated_at_block)
     VALUES (@address, @role, @status, @name, @college, @registeredAtBlock, @updatedAtBlock)
     ON CONFLICT(address) DO UPDATE SET
       role = excluded.role,
       status = excluded.status,
       name = excluded.name,
       college = excluded.college,
       updated_at_block = excluded.updated_at_block`
  ).run(actor);
}

export function updateActorStatus(address, status, updatedAtBlock) {
  db.prepare(
    "UPDATE actors SET status = ?, updated_at_block = ? WHERE address = ?"
  ).run(status, updatedAtBlock, address);
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
