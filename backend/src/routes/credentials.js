import { Router } from "express";
import { ethers } from "ethers";
import { getActor } from "../db.js";
import { getUserSigner } from "../wallets.js";
import { credentialIssuerAsSigner, credentialIssuerRead, ROLE, STATUS, CRED_TYPE } from "../chain.js";
import { findEventInReceipt, syncCredentialIssued } from "../indexer.js";
import { withWalletLock } from "../txQueue.js";
import { logger } from "../logger.js";

export const credentialsRouter = Router();

credentialsRouter.post("/issue", async (req, res) => {
  const { studentAddress, ipfsHash, credType } = req.body || {};
  const credTypeNumber = CRED_TYPE[credType];
  if (!ethers.isAddress(studentAddress) || !ipfsHash || credTypeNumber === undefined) {
    return res.status(400).json({
      error: "a valid studentAddress, ipfsHash, and a valid credType are required",
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
    const receipt = await withWalletLock(req.user.address, async (nonce) => {
      const signer = getUserSigner(req.user.id);
      const issuer = credentialIssuerAsSigner(signer);
      const tx = await issuer.issueCredential(studentAddress, ipfsHash, credTypeNumber, { nonce });
      return tx.wait();
    });

    const args = findEventInReceipt(credentialIssuerRead, "CredentialIssued", receipt);
    if (args) syncCredentialIssued(args, receipt);

    logger.info("credential_issued", {
      issuer: req.user.address,
      student: studentAddress,
      credType,
    });
    res.status(201).json({ txHash: receipt.hash });
  } catch (err) {
    const reason = err.reason || err.shortMessage || err.message;
    logger.error("credential_issue_failed", { issuer: req.user.address, student: studentAddress, reason });
    res.status(400).json({ error: `On-chain credential issuance failed: ${reason}` });
  }
});
