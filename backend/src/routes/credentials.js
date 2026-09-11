import { Router } from "express";
import { ethers } from "ethers";
import { getActor, getCredentialsForStudent } from "../db.js";
import { getUserSigner } from "../wallets.js";
import { credentialIssuerAsSigner, credentialIssuerRead, ROLE, STATUS, CRED_TYPE } from "../chain.js";
import { findEventInReceipt, syncCredentialIssued } from "../indexer.js";
import { withWalletLock } from "../txQueue.js";
import { withIdempotency, IdempotencyPendingError } from "../idempotency.js";
import { byteLength, MAX_IPFS_HASH_BYTES } from "../limits.js";
import { logger } from "../logger.js";

export const credentialsRouter = Router();

// Written permanently on-chain either way — capped so a careless or hostile
// paste can't bloat every future read of this credential forever. Real IPFS
// CIDs and the app's local mock hashes both comfortably fit well under this.
function validIpfsHash(hash) {
  const trimmed = String(hash || "").trim();
  return trimmed.length > 0 && byteLength(trimmed) <= MAX_IPFS_HASH_BYTES ? trimmed : null;
}

credentialsRouter.post("/issue", async (req, res) => {
  const { studentAddress, credType, idempotencyKey } = req.body || {};
  const credTypeNumber = CRED_TYPE[credType];
  const ipfsHash = validIpfsHash(req.body?.ipfsHash);
  if (!ethers.isAddress(studentAddress) || !ipfsHash || credTypeNumber === undefined) {
    return res.status(400).json({
      error: `a valid studentAddress, ipfsHash (1-${MAX_IPFS_HASH_BYTES} bytes), and a valid credType are required`,
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

  try {
    const receipt = await withIdempotency(req.user.id, idempotencyKey, () =>
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
    if (err instanceof IdempotencyPendingError) {
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
credentialsRouter.post("/:id/correct", async (req, res) => {
  const originalId = Number(req.params.id);
  const { studentAddress, credType, idempotencyKey } = req.body || {};
  const credTypeNumber = CRED_TYPE[credType];
  const ipfsHash = validIpfsHash(req.body?.ipfsHash);
  if (!Number.isInteger(originalId) || originalId < 0) {
    return res.status(400).json({ error: "Invalid credential id" });
  }
  if (!ethers.isAddress(studentAddress) || !ipfsHash || credTypeNumber === undefined) {
    return res.status(400).json({
      error: `a valid studentAddress, ipfsHash (1-${MAX_IPFS_HASH_BYTES} bytes), and a valid credType are required`,
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
  if (original.superseded) {
    return res.status(409).json({
      error: "This credential has already been corrected once — correct the newer version instead.",
    });
  }

  try {
    const receipt = await withIdempotency(req.user.id, idempotencyKey, () =>
      withWalletLock(req.user.address, async (nonce) => {
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
    if (err instanceof IdempotencyPendingError) {
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
