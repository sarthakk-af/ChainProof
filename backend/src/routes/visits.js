import { Router } from "express";
import { getActor } from "../db.js";
import { getUserSigner } from "../wallets.js";
import { placementTrackerAsSigner, placementTrackerRead, ROLE, STATUS } from "../chain.js";
import { findEventInReceipt, syncVisitAnnounced } from "../indexer.js";
import { withWalletLock } from "../txQueue.js";
import { withIdempotency, IdempotencyPendingError } from "../idempotency.js";
import { logger } from "../logger.js";

export const visitsRouter = Router();

visitsRouter.post("/announce", async (req, res) => {
  const { companyName, ipfsHash, visitDate, idempotencyKey } = req.body || {};
  if (!companyName || !ipfsHash || !visitDate) {
    return res.status(400).json({ error: "companyName, ipfsHash, and visitDate are required" });
  }
  // Both strings get written permanently on-chain — capped so a careless or
  // hostile paste can't bloat every future read of this visit record forever.
  const trimmedCompanyName = String(companyName).trim();
  const trimmedIpfsHash = String(ipfsHash).trim();
  if (!trimmedCompanyName || trimmedCompanyName.length > 150) {
    return res.status(400).json({ error: "companyName must be 1-150 characters" });
  }
  if (!trimmedIpfsHash || trimmedIpfsHash.length > 200) {
    return res.status(400).json({ error: "ipfsHash must be 1-200 characters" });
  }
  const visitDateNum = Number(visitDate);
  if (!Number.isFinite(visitDateNum) || visitDateNum <= 0 || !Number.isInteger(visitDateNum)) {
    return res.status(400).json({ error: "visitDate must be a valid unix timestamp" });
  }

  const caller = getActor(req.user.address);
  const callerIsActiveCollege = caller && caller.role === ROLE.College && caller.status === STATUS.Active;
  if (!callerIsActiveCollege) {
    return res.status(403).json({ error: "Only a verifier-approved College can announce visits" });
  }

  try {
    const receipt = await withIdempotency(req.user.id, idempotencyKey, () =>
      withWalletLock(req.user.address, async (nonce) => {
        const signer = getUserSigner(req.user.id);
        const tracker = placementTrackerAsSigner(signer);
        const tx = await tracker.announceVisit(trimmedCompanyName, trimmedIpfsHash, visitDateNum, { nonce });
        return tx.wait();
      })
    );

    const args = findEventInReceipt(placementTrackerRead, "VisitAnnounced", receipt);
    if (args) syncVisitAnnounced(args, receipt);

    logger.info("visit_announced", { college: req.user.address, companyName: trimmedCompanyName });
    res.status(201).json({ txHash: receipt.hash });
  } catch (err) {
    if (err instanceof IdempotencyPendingError) {
      return res.status(409).json({ error: err.message });
    }
    const reason = err.reason || err.shortMessage || err.message;
    logger.error("visit_announce_failed", { college: req.user.address, reason });
    res.status(400).json({ error: `On-chain visit announcement failed: ${reason}` });
  }
});
