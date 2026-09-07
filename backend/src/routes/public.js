import { Router } from "express";
import {
  listActors,
  getPerCollegePlacementStats,
  countPlacedStudentsGlobal,
  getRecentVisits,
} from "../db.js";
import { ROLE, STATUS } from "../chain.js";
import { serializeVisit } from "../serializers.js";

export const publicRouter = Router();

function pct(placed, registered) {
  return registered === 0 ? 0 : Math.round((placed / registered) * 10000) / 100;
}

publicRouter.get("/overview", (_req, res) => {
  const totalColleges = listActors({ role: ROLE.College, status: STATUS.Active }).length;
  const totalCompanies = listActors({ role: ROLE.Company, status: STATUS.Active }).length;
  const totalStudents = listActors({ role: ROLE.Student }).length;
  const totalPlaced = countPlacedStudentsGlobal();

  res.json({
    totalColleges,
    totalCompanies,
    totalStudents,
    totalPlaced,
    overallPlacementPercentage: pct(totalPlaced, totalStudents),
  });
});

publicRouter.get("/colleges", (_req, res) => {
  const colleges = listActors({ role: ROLE.College, status: STATUS.Active });
  const statsByCollege = getPerCollegePlacementStats();

  const merged = colleges.map((c) => {
    const stats = statsByCollege.get(c.address);
    const registered = stats?.registered || 0;
    const placed = stats?.placed || 0;
    return {
      address: c.address,
      name: c.name,
      registered,
      placed,
      percentage: pct(placed, registered),
    };
  });

  res.json({ colleges: merged });
});

publicRouter.get("/visits", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const visits = getRecentVisits(limit).map((v) => ({
    ...serializeVisit(v),
    collegeName: v.college_name,
  }));
  res.json({ visits });
});
