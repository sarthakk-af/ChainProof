import { Router } from "express";
import { ethers } from "ethers";
import {
  getActor,
  listActors,
  listDrives,
  getDrive,
  getDriveFunnelStats,
  getPlacementByBatch,
  getOverviewCounts,
  getRecruiterSummary,
  EVENT_KIND_LABELS,
  listPreparationEvents,
  preparationSummary,
  AUDIENCE,
  listAnnouncements,
} from "../db.js";
import { ROLE, STATUS, DRIVE_STATUS, STAGE, OFFER_RESPONSE } from "../chain.js";
import {
  serializeDrive,
  serializePreparationEvent,
  serializeAnnouncement,
} from "../serializers.js";

/**
 * public.js — what anyone can see without an account.
 *
 * The audience is a parent asking a specific question: what happens when a
 * company comes to this college, and what are the odds. So the shape here is a
 * funnel per drive and a rate per cohort, never a list of people.
 *
 * Two rules hold throughout:
 *   - no individual appears. Not a name, not an address, not a single person's
 *     outcome. Accountability is owed by the institution, not by the student
 *     who didn't get picked;
 *   - every published figure comes from a mirrored chain event, so it is the
 *     one the relevant party signed rather than anything typed into this
 *     database.
 */
export const publicRouter = Router();

function pct(numerator, denominator) {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 10000) / 100;
}

publicRouter.get("/overview", (_req, res) => {
  const counts = getOverviewCounts({
    roleCollege: ROLE.College,
    roleCompany: ROLE.Company,
    roleStudent: ROLE.Student,
    statusActive: STATUS.Active,
  });
  res.json(counts);
});

/**
 * Placement per cohort, with the denominator shown rather than assumed.
 * @dev Both numbers are published side by side on purpose. "92% placed" means
 *      nothing without knowing 92% of what — and the gap between the batch the
 *      college declared and the students who actually signed up is the single
 *      most common place a placement statistic quietly goes wrong.
 */
publicRouter.get("/colleges/:address/placement", (req, res) => {
  const { address } = req.params;
  if (!ethers.isAddress(address)) {
    return res.status(404).json({ error: "No such college" });
  }
  const college = getActor(address);
  if (!college || college.role !== ROLE.College) {
    return res.status(404).json({ error: "No such college" });
  }

  const rows = getPlacementByBatch(address);
  res.json({
    college: { address: college.address, name: college.name },
    batches: rows.map((b) => ({
      batchYear: b.batch_year,
      declaredStrength: b.declared,
      // How many the college listed on its roster, and how many of those
      // actually created an account. A placement rate quoted against the second
      // number rather than the first is the usual sleight of hand.
      listedOnRoster: b.listed,
      registered: b.registered,
      placed: b.placed,
      placementRateOfBatch: pct(b.placed, b.declared),
      placementRateOfRegistered: pct(b.placed, b.registered),
      // Surfaced deliberately: a denominator that keeps moving is worth seeing
      // next to the percentage it produces.
      declaredStrengthRevisions: b.revisions ?? 0,
    })),
  });
});

/** Colleges with a published cohort, for the landing page. */
publicRouter.get("/colleges", (_req, res) => {
  const colleges = listActors({ role: ROLE.College, status: STATUS.Active });
  res.json({
    colleges: colleges.map((c) => ({
      address: c.address,
      name: c.name,
      registrationNumber: c.registration_number || null,
      website: c.metadata || null,
    })),
  });
});

/**
 * Every drive that actually ran, with its funnel.
 * @dev Proposed and Rejected drives are withheld — a company that was declined
 *      never recruited here, and publishing that would expose a private
 *      decision. Cancelled ones *are* shown: a student who applied is entitled
 *      to the fact that the company withdrew.
 */
publicRouter.get("/colleges/:address/drives", (req, res) => {
  const { address } = req.params;
  if (!ethers.isAddress(address)) {
    return res.status(404).json({ error: "No such college" });
  }
  const college = getActor(address);
  if (!college || college.role !== ROLE.College) {
    return res.status(404).json({ error: "No such college" });
  }

  const visible = [DRIVE_STATUS.Approved, DRIVE_STATUS.Closed, DRIVE_STATUS.Cancelled];
  const rows = listDrives({ collegeAddress: address }).filter((d) => visible.includes(d.status));

  res.json({
    college: { address: college.address, name: college.name },
    drives: rows.map((d) => {
      const funnel = getDriveFunnelStats(d.id, {
        stageShortlisted: STAGE.Shortlisted,
        stageAssessment: STAGE.Assessment,
        stageInterview: STAGE.Interview,
        stageOffered: STAGE.Offered,
        acceptedResponse: OFFER_RESPONSE.Accepted,
      });
      return serializeDrive(d, {
        companyName: getActor(d.company_address)?.name ?? null,
        funnel,
      });
    }),
  });
});

/**
 * What the college did to prepare students.
 *
 * The other half of the story, and the reason it is worth publishing: every
 * other figure on this page holds the college to account for *results*. A poor
 * year can always be blamed on a slow market, and until now there was nothing
 * in the record to check that against. This is the college's own evidence of
 * effort — recorded on-chain as the year went, and impossible to top up
 * afterwards.
 *
 * Cancelled entries are shown rather than filtered out. Hiding them would let a
 * college record ten sessions, call off nine, and still look busy.
 */
publicRouter.get("/colleges/:address/preparation", (req, res) => {
  const { address } = req.params;
  if (!ethers.isAddress(address)) {
    return res.status(404).json({ error: "No such college" });
  }
  const college = getActor(address);
  if (!college || college.role !== ROLE.College) {
    return res.status(404).json({ error: "No such college" });
  }

  const batchYear = req.query.batchYear ? Number(req.query.batchYear) : undefined;
  res.json({
    college: { address: college.address, name: college.name },
    summary: preparationSummary(address, { batchYear }),
    events: listPreparationEvents(address, { batchYear }).map((r) =>
      serializePreparationEvent(r, EVENT_KIND_LABELS)
    ),
  });
});

/**
 * Placement notices marked public.
 *
 * @dev Only the ones explicitly addressed to everyone. A notice aimed at
 *      students — a room change, a reporting time — is operational detail that
 *      a parent-facing page would only clutter, and publishing it by default
 *      would make the author think twice about posting at all.
 */
publicRouter.get("/colleges/:address/announcements", (req, res) => {
  const { address } = req.params;
  if (!ethers.isAddress(address)) {
    return res.status(404).json({ error: "No such college" });
  }
  const college = getActor(address);
  if (!college || college.role !== ROLE.College) {
    return res.status(404).json({ error: "No such college" });
  }

  res.json({
    announcements: listAnnouncements(address, { audience: AUDIENCE.Public, limit: 25 }).map(
      serializeAnnouncement
    ),
  });
});

/** One drive's funnel on its own. */
publicRouter.get("/drives/:id", (req, res) => {
  const driveId = Number(req.params.id);
  const drive = getDrive(driveId);
  const visible = [DRIVE_STATUS.Approved, DRIVE_STATUS.Closed, DRIVE_STATUS.Cancelled];
  if (!drive || !visible.includes(drive.status)) {
    return res.status(404).json({ error: "No such drive" });
  }

  const funnel = getDriveFunnelStats(driveId, {
    stageShortlisted: STAGE.Shortlisted,
    stageAssessment: STAGE.Assessment,
    stageInterview: STAGE.Interview,
    stageOffered: STAGE.Offered,
    acceptedResponse: OFFER_RESPONSE.Accepted,
  });

  res.json({
    drive: serializeDrive(drive, {
      companyName: getActor(drive.company_address)?.name ?? null,
      collegeName: getActor(drive.college_address)?.name ?? null,
      funnel,
    }),
  });
});

/** Which companies actually recruit here, and what they pay. */
publicRouter.get("/colleges/:address/recruiters", (req, res) => {
  const { address } = req.params;
  if (!ethers.isAddress(address)) {
    return res.status(404).json({ error: "No such college" });
  }
  res.json({
    recruiters: getRecruiterSummary(address).map((r) => ({
      companyName: r.company_name,
      driveCount: r.drive_count,
      highestPackage: r.highest_package,
      lowestPackage: r.lowest_package,
      latestDrive: r.latest_drive,
    })),
  });
});
