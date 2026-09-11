import { Router } from "express";
import {
  listActors,
  getPerCollegePlacementStats,
  countPlacedStudentsGlobal,
  getRecentVisits,
  getCollegeRecords,
  getActor,
} from "../db.js";
import { ROLE, STATUS } from "../chain.js";
import { serializeVisit, CRED_TYPE_NAMES, ROLE_NAMES } from "../serializers.js";

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
      // Two colleges can share a display name — this is the identifier that
      // tells a visitor which one they're actually looking at, and it's meant
      // to be looked up independently anyway.
      registrationNumber: c.registration_number || null,
      registered,
      placed,
      percentage: pct(placed, registered),
    };
  });

  res.json({ colleges: merged });
});

// The "verify it yourself" endpoint — the individual records behind one
// college's percentage. Deliberately omits student identity (see
// getCollegeRecords's doc comment) — shows the record itself, not who it's about.
publicRouter.get("/colleges/:address/records", (req, res) => {
  const college = getActor(req.params.address);
  if (!college || college.role !== ROLE.College) {
    return res.status(404).json({ error: "No such college" });
  }
  const records = getCollegeRecords(req.params.address).map((r) => ({
    id: r.id,
    credType: CRED_TYPE_NAMES[r.cred_type],
    timestamp: r.timestamp,
    issuerAddress: r.issuer_address,
    issuerName: r.issuer_name || null,
    issuerRole: r.issuer_role !== null && r.issuer_role !== undefined ? ROLE_NAMES[r.issuer_role] : null,
  }));
  res.json({ college: { address: college.address, name: college.name }, records });
});

publicRouter.get("/visits", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const visits = getRecentVisits(limit).map((v) => ({
    ...serializeVisit(v),
    collegeName: v.college_name,
  }));
  res.json({ visits });
});
