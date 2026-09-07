import { Router } from "express";
import { ethers } from "ethers";
import { getActor, getUserById } from "../db.js";
import { getUserSigner } from "../wallets.js";
import { actorRegistryAsSigner, ROLE, STATUS } from "../chain.js";
import { syncActor } from "../indexer.js";
import { withWalletLock } from "../txQueue.js";
import { serializeActor } from "../serializers.js";
import { logger } from "../logger.js";

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

meRouter.post("/register", async (req, res) => {
  const { role, name, collegeAddress } = req.body || {};
  const roleNumber = ROLE[role];
  if (roleNumber === undefined || roleNumber === ROLE.None) {
    return res.status(400).json({
      error: `Invalid role: "${role}". Expected one of: Student, College, Company`,
    });
  }
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  if (roleNumber === ROLE.Student && !ethers.isAddress(collegeAddress)) {
    return res.status(400).json({ error: "A valid collegeAddress is required for Student registration" });
  }

  // A Rejected actor may resubmit — the contract itself allows this (see
  // ActorRegistry.sol's `register`), so this check must match, not just
  // block anything with an existing row.
  const existing = getActor(req.user.address);
  if (existing && existing.status !== STATUS.Rejected) {
    return res.status(409).json({ error: "This account is already registered on-chain" });
  }

  try {
    await withWalletLock(req.user.address, async (nonce) => {
      const signer = getUserSigner(req.user.id);
      const registry = actorRegistryAsSigner(signer);
      const tx = await registry.register(
        roleNumber,
        name.trim(),
        "",
        roleNumber === ROLE.Student ? collegeAddress : "0x0000000000000000000000000000000000000000",
        { nonce }
      );
      const receipt = await tx.wait();
      await syncActor(req.user.address, receipt.blockNumber);
    });
    logger.info("actor_registered", { address: req.user.address, role, name: name.trim() });
    res.status(201).json({ actor: serializeActor(getActor(req.user.address)) });
  } catch (err) {
    const reason = err.reason || err.shortMessage || err.message;
    logger.error("registration_failed", { address: req.user.address, role, reason });
    res.status(400).json({ error: `On-chain registration failed: ${reason}` });
  }
});
