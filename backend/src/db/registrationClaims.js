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
    ).run(registrationNumber, address.toLowerCase(), Date.now());
    return true;
  } catch {
    // Lost a race to a concurrent insert — the PRIMARY KEY did its job.
    return false;
  }
}

/**
 * Releases whatever claim this address holds — used when a registration fails
 * partway.
 *
 * Matched case-insensitively to stay consistent with the ownership test in
 * claimRegistrationNumber above. Ethereum addresses are checksummed mixed
 * case, so a caller passing a differently-cased form of the same address
 * would otherwise release nothing here while still counting as the owner
 * there — leaving the identifier claimed by an address that can never free
 * it, and unrecoverable without direct database access.
 */
export function releaseClaimsForAddress(address) {
  db.prepare("DELETE FROM registration_number_claims WHERE LOWER(address) = LOWER(?)").run(address);
}
