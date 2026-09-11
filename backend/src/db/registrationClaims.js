import { db } from "./connection.js";

/**
 * Two-phase claim on an institution's real-world identifier (CIN /
 * accreditation ID) — see connection.js's registration_number_claims comment
 * for why this is a separate table rather than a UNIQUE column.
 *
 * The claim is taken before the on-chain write and released if that write
 * fails, so a duplicate is rejected with nothing permanent having happened,
 * and two simultaneous registrations can't both slip through a check-then-act
 * gap: the PRIMARY KEY makes the second insert fail outright.
 */

/** Returns the claim row, or undefined. */
export function getRegistrationNumberClaim(registrationNumber) {
  return db
    .prepare("SELECT * FROM registration_number_claims WHERE registration_number = ?")
    .get(registrationNumber);
}

/**
 * Takes the claim for `address`. Returns true if claimed, false if some other
 * address already holds it. Re-claiming a number this same address already
 * holds succeeds — that's a resubmission after rejection, not a conflict.
 */
export function claimRegistrationNumber(registrationNumber, address) {
  const existing = getRegistrationNumberClaim(registrationNumber);
  if (existing) {
    return existing.address.toLowerCase() === address.toLowerCase();
  }
  try {
    db.prepare(
      "INSERT INTO registration_number_claims (registration_number, address, created_at) VALUES (?, ?, ?)"
    ).run(registrationNumber, address, Date.now());
    return true;
  } catch {
    // Lost a race to a concurrent insert — the PRIMARY KEY did its job.
    return false;
  }
}

/** Releases whatever claim this address holds — used when a registration fails partway. */
export function releaseClaimsForAddress(address) {
  db.prepare("DELETE FROM registration_number_claims WHERE address = ?").run(address);
}

/**
 * Display names that more than one actor currently uses, lowercased. Powers
 * the admin queue's "shared name" flag — a shared name isn't blocked, but an
 * admin should see it before approving.
 */
export function findDuplicateNames() {
  const rows = db
    .prepare(
      `SELECT LOWER(TRIM(name)) AS normalized
       FROM actors
       GROUP BY LOWER(TRIM(name))
       HAVING COUNT(*) > 1`
    )
    .all();
  return new Set(rows.map((r) => r.normalized));
}
