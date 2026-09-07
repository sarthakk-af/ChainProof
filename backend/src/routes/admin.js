import { Router } from "express";
import { listActors, getActor, updateActorStatus } from "../db.js";
import { actorRegistryAsVerifier, verifierSigner, provider, ROLE, STATUS } from "../chain.js";
import { serializeActor, parseEnumQueryParam, STATUS_NAMES } from "../serializers.js";
import { withWalletLock } from "../txQueue.js";
import { logger } from "../logger.js";

export const adminRouter = Router();

adminRouter.get("/actors", (req, res) => {
  try {
    const role = parseEnumQueryParam(req.query.role, ROLE, "role");
    const status = parseEnumQueryParam(req.query.status, STATUS, "status");
    const rows = listActors({ role, status });
    res.json({ actors: rows.map(serializeActor) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

adminRouter.get("/actors/:address", (req, res) => {
  const row = getActor(req.params.address);
  if (!row) {
    return res.status(404).json({ error: "Actor not found" });
  }
  res.json({ actor: serializeActor(row) });
});

async function handleVerifierAction(req, res, { contractMethod, expectedResultingStatus, event }) {
  const { address } = req.params;
  const cached = getActor(address);
  if (!cached) {
    return res.status(404).json({ error: "Actor not found in index. Has it been registered on-chain?" });
  }
  if (cached.status !== STATUS.Pending) {
    return res.status(409).json({
      error: `Actor is not Pending (current status: ${STATUS_NAMES[cached.status]})`,
    });
  }

  try {
    // The verifier is one shared signer across every admin action, same as
    // the treasury signer — needs the same explicit nonce handling (see
    // txQueue.js) to avoid two approvals close together colliding.
    const receipt = await withWalletLock(verifierSigner.address, async (nonce) => {
      const tx = await actorRegistryAsVerifier[contractMethod](address, { nonce });
      return tx.wait();
    });
    updateActorStatus(address, expectedResultingStatus, receipt.blockNumber);
    logger.info(event, { address, name: cached.name });
    res.json({ actor: serializeActor(getActor(address)), txHash: receipt.hash });
  } catch (err) {
    const reason = err.reason || err.shortMessage || err.message;
    logger.error("verifier_action_failed", { address, event, reason });
    res.status(502).json({ error: `On-chain transaction failed: ${reason}` });
  }
}

adminRouter.post("/actors/:address/approve", (req, res) =>
  handleVerifierAction(req, res, {
    contractMethod: "approveActor",
    expectedResultingStatus: STATUS.Active,
    event: "actor_approved",
  })
);

adminRouter.post("/actors/:address/reject", (req, res) =>
  handleVerifierAction(req, res, {
    contractMethod: "rejectActor",
    expectedResultingStatus: STATUS.Rejected,
    event: "actor_rejected",
  })
);

// Exposed for tests / health checks that want to confirm chain connectivity.
adminRouter.get("/health", async (_req, res) => {
  try {
    const blockNumber = await provider.getBlockNumber();
    res.json({ status: "ok", blockNumber });
  } catch (err) {
    res.status(503).json({ status: "error", error: err.message });
  }
});
