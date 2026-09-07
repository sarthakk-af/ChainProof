import { Router } from "express";
import { ethers } from "ethers";
import { listActors, getVisitsForCollege } from "../db.js";
import { actorRegistryRead, credentialIssuerRead, ROLE, STATUS } from "../chain.js";
import { serializeActor, serializeVisit } from "../serializers.js";

export const collegesRouter = Router();

collegesRouter.get("/", (_req, res) => {
  const rows = listActors({ role: ROLE.College, status: STATUS.Active });
  res.json({ colleges: rows.map(serializeActor) });
});

collegesRouter.get("/:address/placement", async (req, res) => {
  const { address } = req.params;
  if (!ethers.isAddress(address)) {
    return res.status(400).json({ error: "Invalid college address" });
  }
  try {
    const [registered, placed, percentageScaled] = await Promise.all([
      actorRegistryRead.totalRegisteredStudents(address),
      credentialIssuerRead.totalPlacedStudents(address),
      credentialIssuerRead.getPlacementPercentage(address),
    ]);
    res.json({
      registered: Number(registered),
      placed: Number(placed),
      percentage: Number(percentageScaled) / 100,
    });
  } catch (err) {
    res.status(502).json({ error: `Could not read placement stats: ${err.message}` });
  }
});

collegesRouter.get("/:address/visits", (req, res) => {
  const visits = getVisitsForCollege(req.params.address);
  res.json({ visits: visits.map(serializeVisit) });
});
