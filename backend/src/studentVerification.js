import {
  getUserById,
  getActor,
  getRosterEntry,
  claimRosterEntry,
  releaseRosterClaim,
  upsertProfile,
  upsertVerification,
  getVerification,
  setVerificationStatus,
  rollNumberPending,
  VERIFICATION,
} from "./db.js";
import { getUserSigner } from "./wallets.js";
import { actorRegistryAsSigner, ROLE, STATUS } from "./chain.js";
import { syncActor } from "./indexer.js";
import { withWalletLock } from "./txQueue.js";
import { parseField, parseFields, SELF_FIELDS } from "./studentProfile.js";
import { logger } from "./logger.js";

/**
 * studentVerification.js — the single place a student becomes real.
 *
 * Everything routes through `tryComplete`, because verification depends on two
 * independent things landing in either order: the student proving their email,
 * and their roll number being matched to the college's roster. Whichever
 * happens second is what completes it. Written once, so there is no chance of
 * one path forgetting a condition the other enforces.
 *
 * The on-chain write happens here and nowhere else. It is deliberately the last
 * step: a signup that never comes back should cost no gas and should never
 * appear in the registered-student count that every placement percentage is
 * divided by.
 */

/** Everything the UI needs to tell a student what is still missing. */
export function verificationState(user) {
  const actor = getActor(user.wallet_address);
  const request = getVerification(user.id);

  const emailVerified = !!user.email_verified;
  const rollClaimed = !!request && request.status === VERIFICATION.Verified;
  const onChain = !!actor && actor.role === ROLE.Student && actor.status === STATUS.Active;

  const missing = [];
  if (!emailVerified) missing.push("email");
  if (!request) missing.push("rollNumber");
  else if (request.status === VERIFICATION.Pending) missing.push("collegeApproval");

  return {
    verified: onChain,
    emailVerified,
    // The database row is snake_case; reading `request.rollNumber` here silently
    // produced null, which the banner would have rendered as "confirming roll
    // number undefined".
    rollNumber: request?.roll_number ?? null,
    collegeAddress: request?.college_address ?? null,
    requestStatus: request
      ? Object.keys(VERIFICATION).find((k) => VERIFICATION[k] === request.status)
      : null,
    rejectionReason: request?.status === VERIFICATION.Rejected ? request.reason : null,
    missing,
  };
}

/**
 * Records a student's claim to a roll number.
 *
 * If the roster already lists it, this verifies them outright. If it doesn't,
 * the claim is queued for the placement cell — which is the case the first
 * build had no answer to at all.
 */
export async function claimRollNumber({ userId, collegeAddress, rollNumber, profileInput }) {
  const user = getUserById(userId);
  if (!user) return { error: "No such account." };

  const existing = getVerification(userId);
  if (existing?.status === VERIFICATION.Verified) {
    const actor = getActor(user.wallet_address);
    if (actor && actor.role === ROLE.Student && actor.status === STATUS.Active) {
      return { error: "This account is already verified." };
    }
    // Verified here but missing on-chain. That happens when the chain write
    // failed transiently, or when a local chain was reset underneath a database
    // that kept its rows — and until now there was no way back: the student was
    // told they were already verified while every route that mattered refused
    // them for not being registered. Retrying is safe, because tryComplete
    // re-checks every condition and does nothing if the actor is already there.
    logger.info("verification_repair_attempt", { userId, address: user.wallet_address });
    const repaired = await tryComplete(userId);
    return { matched: true, repaired: true, ...repaired };
  }

  const college = getActor(collegeAddress);
  if (!college || college.role !== ROLE.College || college.status !== STATUS.Active) {
    return { error: "That college isn't set up on this platform." };
  }

  const rollCheck = parseField("roll_number", rollNumber);
  if (rollCheck.error) return { error: rollCheck.error };
  const roll = rollCheck.value;

  // Optional profile fields can be supplied now or later; a bad value here
  // shouldn't block the claim itself.
  let selfValues = {};
  if (profileInput) {
    const parsed = parseFields(SELF_FIELDS, profileInput);
    if (parsed.error) return { error: parsed.error };
    selfValues = parsed.values;
  }

  const rosterRow = getRosterEntry(collegeAddress, roll);

  if (rosterRow) {
    if (rosterRow.claimed_by && rosterRow.claimed_by.toLowerCase() !== user.wallet_address.toLowerCase()) {
      return { error: "That roll number has already been claimed. Check it with your placement cell." };
    }
    if (!rosterRow.claimed_by && !claimRosterEntry(collegeAddress, roll, user.wallet_address)) {
      return { error: "That roll number has already been claimed. Check it with your placement cell." };
    }

    upsertVerification({
      userId,
      address: user.wallet_address,
      collegeAddress,
      rollNumber: roll,
      status: VERIFICATION.Verified,
    });
    upsertProfile(user.wallet_address, collegeAddress, {
      roll_number: rosterRow.roll_number,
      full_name: rosterRow.full_name,
      course_code: rosterRow.course_code,
      batch_year: rosterRow.batch_year,
      ...selfValues,
    });

    const result = await tryComplete(userId);
    return { matched: true, ...result };
  }

  // Not on the roster — queue it rather than refuse.
  if (rollNumberPending(collegeAddress, roll, userId)) {
    return { error: "Someone has already requested verification with that roll number." };
  }
  upsertVerification({
    userId,
    address: user.wallet_address,
    collegeAddress,
    rollNumber: roll,
    status: VERIFICATION.Pending,
  });
  if (Object.keys(selfValues).length > 0) {
    upsertProfile(user.wallet_address, collegeAddress, selfValues);
  }

  logger.info("verification_queued", { userId, collegeAddress, rollNumber: roll });
  return { matched: false, queued: true };
}

/**
 * The placement cell approves a queued student, supplying the roster details
 * the roster itself did not have.
 */
export async function approveQueuedStudent({ userId, collegeAddress, rosterDetails }) {
  const request = getVerification(userId);
  if (!request || request.status !== VERIFICATION.Pending) {
    return { error: "That request is no longer pending." };
  }
  if (request.college_address.toLowerCase() !== collegeAddress.toLowerCase()) {
    return { error: "That request belongs to another college." };
  }

  const user = getUserById(userId);
  const roll = request.roll_number;

  // Approving creates the roster row the student was claiming against, so the
  // roster stays the single record of who belongs here — rather than approval
  // becoming a second, quieter way in.
  const { upsertRosterEntries } = await import("./db.js");
  upsertRosterEntries(collegeAddress, [
    {
      roll_number: roll,
      full_name: rosterDetails.full_name,
      course_code: rosterDetails.course_code,
      batch_year: rosterDetails.batch_year,
    },
  ]);
  if (!claimRosterEntry(collegeAddress, roll, user.wallet_address)) {
    return { error: "That roll number was claimed by someone else in the meantime." };
  }

  setVerificationStatus(userId, VERIFICATION.Verified);
  upsertProfile(user.wallet_address, collegeAddress, {
    roll_number: roll,
    full_name: rosterDetails.full_name,
    course_code: rosterDetails.course_code,
    batch_year: rosterDetails.batch_year,
  });

  const result = await tryComplete(userId);
  return { approved: true, ...result };
}

export function rejectQueuedStudent({ userId, collegeAddress, reason }) {
  const request = getVerification(userId);
  if (!request || request.status !== VERIFICATION.Pending) {
    return { error: "That request is no longer pending." };
  }
  if (request.college_address.toLowerCase() !== collegeAddress.toLowerCase()) {
    return { error: "That request belongs to another college." };
  }
  setVerificationStatus(userId, VERIFICATION.Rejected, reason || null);
  logger.info("verification_rejected", { userId, reason });
  return { rejected: true };
}

/**
 * Writes the student on-chain, once every condition is met.
 *
 * Safe to call repeatedly and from either direction — whichever of email
 * verification or roster matching lands second is the one that triggers it.
 * Returns what is still outstanding rather than throwing, because "not yet" is
 * an ordinary state here, not an error.
 */
export async function tryComplete(userId) {
  const user = getUserById(userId);
  if (!user) return { completed: false, reason: "no-such-user" };

  const request = getVerification(userId);
  if (!request || request.status !== VERIFICATION.Verified) {
    return { completed: false, reason: "awaiting-roll-number" };
  }
  if (!user.email_verified) {
    return { completed: false, reason: "awaiting-email" };
  }

  const existingActor = getActor(user.wallet_address);
  if (existingActor && existingActor.status !== STATUS.Rejected) {
    return { completed: true, alreadyOnChain: true };
  }

  const rosterRow = getRosterEntry(request.college_address, request.roll_number);
  if (!rosterRow) {
    return { completed: false, reason: "roster-row-missing" };
  }

  // Checked before spending gas, and named explicitly: the contract refuses a
  // student whose college is not Active, and its custom error decodes to
  // "execution reverted (unknown custom error)" through a signer that does not
  // hold the registry's ABI — which says nothing at all to whoever has to fix
  // it. Reaching here means the college was suspended, or the chain was reset
  // under a database that kept these rows.
  const college = getActor(request.college_address);
  if (!college || college.role !== ROLE.College || college.status !== STATUS.Active) {
    return { completed: false, reason: "college-not-active" };
  }

  try {
    await withWalletLock(user.wallet_address, async (nonce) => {
      // Re-read under the lock: two requests arriving together would otherwise
      // both pass the check above and the loser would pay gas to revert.
      const current = getActor(user.wallet_address);
      if (current && current.status !== STATUS.Rejected) return;

      const registry = actorRegistryAsSigner(getUserSigner(userId));
      const tx = await registry.register(
        ROLE.Student,
        rosterRow.full_name,
        "",
        request.college_address,
        { nonce }
      );
      const receipt = await tx.wait();
      await syncActor(user.wallet_address, receipt.blockNumber);
    });

    logger.info("student_verified", {
      userId,
      address: user.wallet_address,
      rollNumber: request.roll_number,
    });
    return { completed: true };
  } catch (err) {
    // The claim is deliberately NOT released here. The student is legitimately
    // verified; only the chain write failed, and the reconciliation path can
    // retry it. Releasing would hand their roll number to someone else because
    // of a transient RPC error.
    const reason = err.reason || err.shortMessage || err.message;
    logger.error("student_onchain_registration_failed", { userId, reason });
    return { completed: false, reason: "chain-write-failed", detail: reason };
  }
}
