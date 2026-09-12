import { Router } from "express";
import { ethers } from "ethers";
import { getActor, getCredentialsForStudent } from "../db.js";
import { getUserSigner } from "../wallets.js";
import { credentialIssuerAsSigner, credentialIssuerRead, ROLE, STATUS, CRED_TYPE } from "../chain.js";
import { findEventInReceipt, syncCredentialIssued } from "../indexer.js";
import { withWalletLock } from "../txQueue.js";
import {
  withIdempotency,
  fingerprintPayload,
  IdempotencyPendingError,
  IdempotencyKeyConflictError,
} from "../idempotency.js";
import { byteLength, MAX_IPFS_HASH_BYTES } from "../limits.js";
import { validateIpfsHash } from "../ipfsHash.js";
import { logger } from "../logger.js";
import { issueLimiter } from "../middleware/chainWriteLimiter.js";

export const credentialsRouter = Router();

credentialsRouter.post("/issue", issueLimiter, async (req, res) => {
  const { studentAddress, credType, idempotencyKey } = req.body || {};
  const credTypeNumber = CRED_TYPE[credType];
  const hashCheck = validateIpfsHash(req.body?.ipfsHash);
  if (hashCheck.error) {
    return res.status(400).json({ error: hashCheck.error });
  }
  const ipfsHash = hashCheck.value;
  if (!ethers.isAddress(studentAddress) || credTypeNumber === undefined) {
    return res.status(400).json({
      error: "a valid studentAddress and credType are required",
    });
  }

  const caller = getActor(req.user.address);
  const callerIsIssuer =
    caller &&
    (caller.role === ROLE.College || caller.role === ROLE.Company) &&
    caller.status === STATUS.Active;
  if (!callerIsIssuer) {
    return res
      .status(403)
      .json({ error: "Only a verifier-approved College or Company can issue credentials" });
  }

  // Checked here, before ever touching the chain, so a mistyped or
  // not-yet-registered address gets a plain, specific explanation instead of
  // a raw "execution reverted" string bubbling up from the contract revert.
  const recipient = getActor(studentAddress);
  if (!recipient || recipient.role !== ROLE.Student) {
    return res.status(400).json({
      error: "That address isn't a registered student — double-check it and try again.",
    });
  }

  // A College's authority extends to its own students and no further. A
  // Company's doesn't work that way — it recruits across institutions, so it
  // may issue to any registered student.
  //
  // Without this, any approved college could write records onto students
  // enrolled elsewhere: vouching for people it has no relationship with, and
  // moving another institution's public placement figures, which are grouped
  // by the student's own college.
  if (
    caller.role === ROLE.College &&
    (recipient.college || "").toLowerCase() !== req.user.address.toLowerCase()
  ) {
    return res.status(403).json({
      error: "A college can only issue credentials to its own students.",
    });
  }

  // Only the employer can truthfully say it made an offer. The contract
  // enforces this too (OnlyCompanyCanIssueOffer) — this check exists so the
  // refusal arrives as a sentence rather than a decoded revert.
  if (credTypeNumber === CRED_TYPE.Offer && caller.role !== ROLE.Company) {
    return res.status(403).json({
      error:
        "Only a company can issue an Offer — it's the record that marks a student placed. " +
        "A college can issue General, Shortlist, Interview or Rejection credentials.",
    });
  }

  try {
    const fingerprint = fingerprintPayload(["issue", studentAddress, credTypeNumber, ipfsHash]);
    const receipt = await withIdempotency(req.user.id, idempotencyKey, fingerprint, () =>
      withWalletLock(req.user.address, async (nonce) => {
        const signer = getUserSigner(req.user.id);
        const issuer = credentialIssuerAsSigner(signer);
        const tx = await issuer.issueCredential(studentAddress, ipfsHash, credTypeNumber, { nonce });
        return tx.wait();
      })
    );

    // Runs again on an idempotent replay (cached receipt, no new tx) too —
    // upsertCredential is `ON CONFLICT(id) DO NOTHING`, so re-syncing the
    // same on-chain event here is a harmless no-op, not a duplicate row.
    const args = findEventInReceipt(credentialIssuerRead, "CredentialIssued", receipt);
    if (args) syncCredentialIssued(args, receipt);

    logger.info("credential_issued", {
      issuer: req.user.address,
      student: studentAddress,
      credType,
    });
    res.status(201).json({ txHash: receipt.hash });
  } catch (err) {
    if (err instanceof IdempotencyPendingError || err instanceof IdempotencyKeyConflictError) {
      return res.status(409).json({ error: err.message });
    }
    const reason = err.reason || err.shortMessage || err.message;
    logger.error("credential_issue_failed", { issuer: req.user.address, student: studentAddress, reason });
    res.status(400).json({ error: `On-chain credential issuance failed: ${reason}` });
  }
});

// Corrects an earlier credential — the original is never edited or removed,
// only flagged superseded, with this new row explicitly linked to it. See
// CredentialIssuer.sol's issueCorrection for why (a rescinded offer, a typo'd
// grade — the history stays visible instead of quietly disappearing).
credentialsRouter.post("/:id/correct", issueLimiter, async (req, res) => {
  const originalId = Number(req.params.id);
  const { studentAddress, credType, idempotencyKey } = req.body || {};
  const credTypeNumber = CRED_TYPE[credType];
  if (!Number.isInteger(originalId) || originalId < 0) {
    return res.status(400).json({ error: "Invalid credential id" });
  }
  const hashCheck = validateIpfsHash(req.body?.ipfsHash);
  if (hashCheck.error) {
    return res.status(400).json({ error: hashCheck.error });
  }
  const ipfsHash = hashCheck.value;
  if (!ethers.isAddress(studentAddress) || credTypeNumber === undefined) {
    return res.status(400).json({
      error: "a valid studentAddress and credType are required",
    });
  }

  const caller = getActor(req.user.address);
  const callerIsIssuer =
    caller &&
    (caller.role === ROLE.College || caller.role === ROLE.Company) &&
    caller.status === STATUS.Active;
  if (!callerIsIssuer) {
    return res
      .status(403)
      .json({ error: "Only a verifier-approved College or Company can issue corrections" });
  }

  // Same pre-validation philosophy as /issue — catch what's cheap and
  // knowable locally so a bad correction attempt gets a clean, specific
  // message instead of a raw contract revert.
  const original = getCredentialsForStudent(studentAddress).find((c) => c.id === originalId);
  if (!original) {
    return res.status(404).json({ error: "That student has no credential with that id." });
  }
  if (original.issuer_address.toLowerCase() !== req.user.address.toLowerCase()) {
    return res.status(403).json({ error: "Only the original issuer can correct this credential." });
  }
  // Correcting something *into* an Offer would otherwise route around the rule
  // above — the contract blocks it either way.
  if (credTypeNumber === CRED_TYPE.Offer && caller.role !== ROLE.Company) {
    return res.status(403).json({
      error: "Only a company can issue an Offer, including by correction.",
    });
  }
  if (original.superseded) {
    return res.status(409).json({
      error: "This credential has already been corrected once — correct the newer version instead.",
    });
  }

  // Sentinel for "someone corrected this while we were queued" — thrown from
  // inside the lock and mapped to a 409 below.
  const ALREADY_CORRECTED = Symbol("already-corrected");

  try {
    const fingerprint = fingerprintPayload(["correct", originalId, studentAddress, credTypeNumber, ipfsHash]);
    const receipt = await withIdempotency(req.user.id, idempotencyKey, fingerprint, () =>
      withWalletLock(req.user.address, async (nonce) => {
        // Re-read under the lock: the superseded check above runs before
        // queuing, so two corrections fired together both pass it and the
        // loser pays gas to revert with an error ethers cannot even name.
        const latest = getCredentialsForStudent(studentAddress).find((c) => c.id === originalId);
        if (!latest || latest.superseded) throw ALREADY_CORRECTED;
        const signer = getUserSigner(req.user.id);
        const issuer = credentialIssuerAsSigner(signer);
        const tx = await issuer.issueCorrection(studentAddress, originalId, ipfsHash, credTypeNumber, { nonce });
        return tx.wait();
      })
    );

    const args = findEventInReceipt(credentialIssuerRead, "CredentialIssued", receipt);
    if (args) syncCredentialIssued(args, receipt);

    logger.info("credential_corrected", {
      issuer: req.user.address,
      student: studentAddress,
      originalId,
      credType,
    });
    res.status(201).json({ txHash: receipt.hash });
  } catch (err) {
    if (err === ALREADY_CORRECTED) {
      return res.status(409).json({
        error: "This credential has already been corrected once — correct the newer version instead.",
      });
    }
    if (err instanceof IdempotencyPendingError || err instanceof IdempotencyKeyConflictError) {
      return res.status(409).json({ error: err.message });
    }
    const reason = err.reason || err.shortMessage || err.message;
    logger.error("credential_correction_failed", {
      issuer: req.user.address,
      student: studentAddress,
      originalId,
      reason,
    });
    res.status(400).json({ error: `On-chain correction failed: ${reason}` });
  }
});
