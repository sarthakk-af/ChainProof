import { Router } from "express";
import { ethers } from "ethers";
import {
  getActor,
  getUserById,
  clearRejectionReason,
  setWebsiteReachable,
  setJoinCode,
  setRegistrationNumber,
  claimRegistrationNumber,
  releaseClaimsForAddress,
} from "../db.js";
import { generateJoinCode, normalizeJoinCode } from "../joinCode.js";
import { getUserSigner } from "../wallets.js";
import { actorRegistryAsSigner, ROLE, STATUS } from "../chain.js";
import { syncActor } from "../indexer.js";
import { withWalletLock } from "../txQueue.js";
import { serializeActor } from "../serializers.js";
import { validateWebsiteFormat, checkWebsiteReachable } from "../websiteCheck.js";
import { validateRegistrationNumber } from "../registrationNumber.js";
import { byteLength, MAX_NAME_BYTES, MAX_METADATA_BYTES } from "../limits.js";
import { logger } from "../logger.js";
import { registerLimiter } from "../middleware/chainWriteLimiter.js";

export const meRouter = Router();

meRouter.get("/", (req, res) => {
  const user = getUserById(req.user.id);
  const actorRow = getActor(req.user.address);
  res.json({
    email: user.email,
    address: req.user.address,
    actor: actorRow ? serializeActor(actorRow) : null,
  });
});

function requireActiveCollege(req, res) {
  const actor = getActor(req.user.address);
  if (!actor || actor.role !== ROLE.College || actor.status !== STATUS.Active) {
    res.status(403).json({ error: "Only an active College can manage a student invite code." });
    return null;
  }
  return actor;
}

// The code this college hands to its own students — see /register below for
// why a Student can't just pick any college off the list without one.
meRouter.get("/join-code", (req, res) => {
  const actor = requireActiveCollege(req, res);
  if (!actor) return;
  res.json({ joinCode: actor.join_code });
});

meRouter.post("/join-code/regenerate", (req, res) => {
  const actor = requireActiveCollege(req, res);
  if (!actor) return;
  const joinCode = generateJoinCode();
  setJoinCode(req.user.address, joinCode);
  logger.info("join_code_regenerated", { address: req.user.address });
  res.json({ joinCode });
});

meRouter.post("/register", registerLimiter, async (req, res) => {
  const { role, name, collegeAddress, website, joinCode, registrationNumber } = req.body || {};
  const roleNumber = ROLE[role];
  if (roleNumber === undefined || roleNumber === ROLE.None) {
    return res.status(400).json({
      error: `Invalid role: "${role}". Expected one of: Student, College, Company`,
    });
  }
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  // This gets written permanently on-chain — capped so a careless or hostile
  // paste can't bloat every future read of this actor's record forever. The
  // contract enforces the same bound (see limits.js for why it's measured in
  // bytes); this check just gets there first with a readable message.
  if (byteLength(name.trim()) > MAX_NAME_BYTES) {
    return res.status(400).json({ error: `name must be ${MAX_NAME_BYTES} bytes or fewer` });
  }
  if (roleNumber === ROLE.Student) {
    if (!ethers.isAddress(collegeAddress)) {
      return res.status(400).json({ error: "A valid collegeAddress is required for Student registration" });
    }
    // Picking a name off a public list proves nothing on its own — this is
    // what actually ties a Student's registration to some real contact with
    // that institution, since only the college itself can hand this out.
    const targetCollege = getActor(collegeAddress);
    if (!targetCollege || targetCollege.role !== ROLE.College || targetCollege.status !== STATUS.Active) {
      return res.status(400).json({ error: "That college isn't currently verified and active." });
    }
    if (!joinCode || normalizeJoinCode(joinCode) !== normalizeJoinCode(targetCollege.join_code)) {
      return res.status(400).json({
        error: "That invite code doesn't match this college — ask them for the correct one.",
      });
    }
  }
  const websiteCheck = validateWebsiteFormat(website);
  if (websiteCheck.error) {
    return res.status(400).json({ error: websiteCheck.error });
  }
  // Reject rather than silently truncate — cutting a URL mid-string would
  // leave a broken link on-chain forever instead of just a shorter one.
  if (byteLength(websiteCheck.value) > MAX_METADATA_BYTES) {
    return res.status(400).json({ error: `Website URL must be ${MAX_METADATA_BYTES} bytes or fewer` });
  }
  const normalizedWebsite = websiteCheck.value;

  let normalizedRegistrationNumber = "";
  if (roleNumber === ROLE.College || roleNumber === ROLE.Company) {
    const regCheck = validateRegistrationNumber(role, registrationNumber);
    if (regCheck.error) {
      return res.status(400).json({ error: regCheck.error });
    }
    normalizedRegistrationNumber = regCheck.value;
  }

  // A Rejected actor may resubmit — the contract itself allows this (see
  // ActorRegistry.sol's `register`), so this check must match, not just
  // block anything with an existing row.
  const existing = getActor(req.user.address);
  if (existing && existing.status !== STATUS.Rejected) {
    return res.status(409).json({ error: "This account is already registered on-chain" });
  }

  // Claim the real-world identifier *before* writing to the chain, so a
  // duplicate is refused while nothing permanent has happened yet. A
  // resubmission by this same address is free to change its number, so any
  // claim it previously held is dropped first.
  if (normalizedRegistrationNumber) {
    releaseClaimsForAddress(req.user.address);
    if (!claimRegistrationNumber(normalizedRegistrationNumber, req.user.address)) {
      return res.status(409).json({
        error:
          role === "Company"
            ? "That CIN is already registered to another account. A company can only be registered once."
            : "That registration ID is already registered to another account.",
      });
    }
  }

  // Sentinel for "someone else got there while we were queued" — thrown from
  // inside the lock and mapped back to a 409 below, so it isn't reported as an
  // on-chain failure.
  const ALREADY_REGISTERED = Symbol("already-registered");

  try {
    await withWalletLock(req.user.address, async (nonce) => {
      // Re-read under the lock. The check above runs before queuing, so two
      // requests fired together both pass it, both reach the chain, and the
      // loser pays gas for a transaction that reverts with AlreadyRegistered.
      // Re-checking here — where only one request runs at a time — turns that
      // wasted transaction into a clean refusal.
      const current = getActor(req.user.address);
      if (current && current.status !== STATUS.Rejected) {
        throw ALREADY_REGISTERED;
      }
      const signer = getUserSigner(req.user.id);
      const registry = actorRegistryAsSigner(signer);
      const tx = await registry.register(
        roleNumber,
        name.trim(),
        normalizedWebsite,
        roleNumber === ROLE.Student ? collegeAddress : "0x0000000000000000000000000000000000000000",
        { nonce }
      );
      const receipt = await tx.wait();
      await syncActor(req.user.address, receipt.blockNumber);
      // A fresh registration/resubmission starts clean — any reason from a
      // past rejection belonged to that earlier attempt, not this one.
      clearRejectionReason(req.user.address);
    });
    if (normalizedRegistrationNumber) {
      setRegistrationNumber(req.user.address, normalizedRegistrationNumber);
    }
    logger.info("actor_registered", { address: req.user.address, role, name: name.trim() });
    res.status(201).json({ actor: serializeActor(getActor(req.user.address)) });

    // Fire-and-forget: a live HTTP probe can take a few seconds, and the
    // student/college/company submitting the form shouldn't have to wait on
    // it — this is evidence for the *admin* queue, not a gate on the
    // registration itself. Runs after the response is already sent.
    if (normalizedWebsite) {
      checkWebsiteReachable(normalizedWebsite)
        .then((reachable) => setWebsiteReachable(req.user.address, reachable))
        .catch(() => {});
    } else {
      setWebsiteReachable(req.user.address, null);
    }
  } catch (err) {
    if (err === ALREADY_REGISTERED) {
      // Deliberately no claim release here: the registration that won the race
      // belongs to this same address, and its claim is the live one.
      return res.status(409).json({ error: "This account is already registered on-chain" });
    }
    // Nothing made it on-chain, so don't leave this identifier locked up —
    // otherwise a failed attempt would permanently block the real owner from
    // ever registering under their own CIN.
    if (normalizedRegistrationNumber) {
      releaseClaimsForAddress(req.user.address);
    }
    const reason = err.reason || err.shortMessage || err.message;
    logger.error("registration_failed", { address: req.user.address, role, reason });
    res.status(400).json({ error: `On-chain registration failed: ${reason}` });
  }
});
