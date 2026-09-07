import { Router } from "express";
import { getActor } from "../db.js";
import { getUserSigner } from "../wallets.js";
import { placementTrackerAsSigner, placementTrackerRead, ROLE, STATUS } from "../chain.js";
import { findEventInReceipt, syncVisitAnnounced } from "../indexer.js";
import { withWalletLock } from "../txQueue.js";
import { logger } from "../logger.js";

export const visitsRouter = Router();

visitsRouter.post("/announce", async (req, res) => {
  const { companyName, ipfsHash, visitDate } = req.body || {};
  if (!companyName || !ipfsHash || !visitDate) {
    return res.status(400).json({ error: "companyName, ipfsHash, and visitDate are required" });
  }

  const caller = getActor(req.user.address);
  const callerIsActiveCollege = caller && caller.role === ROLE.College && caller.status === STATUS.Active;
  if (!callerIsActiveCollege) {
    return res.status(403).json({ error: "Only a verifier-approved College can announce visits" });
  }

  try {
    const receipt = await withWalletLock(req.user.address, async (nonce) => {
      const signer = getUserSigner(req.user.id);
      const tracker = placementTrackerAsSigner(signer);
      const tx = await tracker.announceVisit(companyName, ipfsHash, visitDate, { nonce });
      return tx.wait();
    });

    const args = findEventInReceipt(placementTrackerRead, "VisitAnnounced", receipt);
    if (args) syncVisitAnnounced(args, receipt);

    logger.info("visit_announced", { college: req.user.address, companyName });
    res.status(201).json({ txHash: receipt.hash });
  } catch (err) {
    const reason = err.reason || err.shortMessage || err.message;
    logger.error("visit_announce_failed", { college: req.user.address, reason });
    res.status(400).json({ error: `On-chain visit announcement failed: ${reason}` });
  }
});
