import { Router } from "express";
import {
  getActor,
  listActors,
  getDrive,
  listDrives,
  getProfile,
  checkEligibility,
  addApplication,
  hasApplied,
  countApplications,
  listApplicants,
  listApplicationsForStudent,
  getCurrentStages,
  getOfferResponse,
} from "../db.js";
import { getUserSigner } from "../wallets.js";
import {
  placementDriveAsSigner,
  placementDriveRead,
  ROLE,
  STATUS,
  DRIVE_STATUS,
  STAGE,
} from "../chain.js";
import { syncDrivePosted, syncDriveStatus, syncApplicationCount, findEventInReceipt } from "../indexer.js";
import { withWalletLock } from "../txQueue.js";
import { serializeDrive, STAGE_NAMES } from "../serializers.js";
import { validateIpfsHash } from "../ipfsHash.js";
import { byteLength } from "../limits.js";
import { withIdempotency, fingerprintPayload, IdempotencyPendingError, IdempotencyKeyConflictError } from "../idempotency.js";
import { issueLimiter, announceLimiter } from "../middleware/chainWriteLimiter.js";
import { logger } from "../logger.js";

/**
 * drives.js — a company's openings, and students applying to them.
 *
 * The authority split this router preserves: a company writes its own terms and
 * its own applicant total; a student decides whether to apply; the college
 * appears nowhere, because hosting decisions live in college.js and the college
 * has no business authoring either side of this.
 */
export const drivesRouter = Router();

const MAX_ROLE_TITLE_BYTES = 100;

function requireActiveCompany(req, res) {
  const actor = getActor(req.user.address);
  if (!actor || actor.role !== ROLE.Company || actor.status !== STATUS.Active) {
    res.status(403).json({ error: "Only a college-approved company can do this." });
    return null;
  }
  return actor;
}

// ============================================================================
// Company: posting and managing its own drives
// ============================================================================

drivesRouter.post("/", announceLimiter, async (req, res) => {
  if (!requireActiveCompany(req, res)) return;

  const {
    collegeAddress,
    roleTitle,
    annualPackage,
    minCgpa,
    batchYear,
    applicationDeadline,
    driveDate,
    ipfsHash,
    idempotencyKey,
  } = req.body || {};

  const college = getActor(collegeAddress);
  if (!college || college.role !== ROLE.College || college.status !== STATUS.Active) {
    return res.status(400).json({ error: "That college isn't currently verified and active." });
  }

  const title = String(roleTitle ?? "").trim();
  if (!title || byteLength(title) > MAX_ROLE_TITLE_BYTES) {
    return res.status(400).json({ error: `Role title must be 1-${MAX_ROLE_TITLE_BYTES} bytes.` });
  }

  const hashCheck = validateIpfsHash(ipfsHash);
  if (hashCheck.error) return res.status(400).json({ error: hashCheck.error });

  const pkg = Number(annualPackage);
  if (!Number.isInteger(pkg) || pkg < 1 || pkg > 1e12) {
    return res.status(400).json({ error: "Annual package must be a whole number of rupees." });
  }

  // CGPA is scaled by 100 on-chain so a cutoff comparison is exact. 7.00 >= 7.00
  // is a coin toss in binary floating point; 700 >= 700 is not.
  const cgpaScaled = minCgpa === undefined || minCgpa === null || minCgpa === "" ? 0 : Math.round(Number(minCgpa) * 100);
  if (!Number.isInteger(cgpaScaled) || cgpaScaled < 0 || cgpaScaled > 1000) {
    return res.status(400).json({ error: "Minimum CGPA must be between 0 and 10." });
  }

  const year = Number(batchYear);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return res.status(400).json({ error: "Batch year must be between 2000 and 2100." });
  }

  const deadline = Number(applicationDeadline);
  const date = Number(driveDate);
  if (!Number.isInteger(deadline) || !Number.isInteger(date) || deadline < 1 || date < 1) {
    return res.status(400).json({ error: "Provide a valid application deadline and drive date." });
  }
  if (deadline > date) {
    return res.status(400).json({ error: "Applications must close on or before the drive date." });
  }

  try {
    const fingerprint = fingerprintPayload(["drive", collegeAddress, title, pkg, cgpaScaled, year, deadline, date, hashCheck.value]);
    const receipt = await withIdempotency(req.user.id, idempotencyKey, fingerprint, () =>
      withWalletLock(req.user.address, async (nonce) => {
        const drives = placementDriveAsSigner(getUserSigner(req.user.id));
        const tx = await drives.postDrive(
          collegeAddress,
          title,
          pkg,
          cgpaScaled,
          year,
          deadline,
          date,
          hashCheck.value,
          { nonce }
        );
        return tx.wait();
      })
    );

    const posted = findEventInReceipt(placementDriveRead, "DrivePosted", receipt);
    if (posted) syncDrivePosted(posted, receipt);
    const status = findEventInReceipt(placementDriveRead, "DriveStatusChanged", receipt);
    if (status) syncDriveStatus(status, receipt);

    logger.info("drive_posted", { company: req.user.address, college: collegeAddress, title });
    res.status(201).json({ txHash: receipt.hash, driveId: posted ? Number(posted[0]) : null });
  } catch (err) {
    if (err instanceof IdempotencyPendingError || err instanceof IdempotencyKeyConflictError) {
      return res.status(409).json({ error: err.message });
    }
    const reason = err.reason || err.shortMessage || err.message;
    logger.error("drive_post_failed", { company: req.user.address, reason });
    res.status(400).json({ error: `On-chain post failed: ${reason}` });
  }
});

/** The company's own drives, with the live application count it can attest to. */
drivesRouter.get("/mine", (req, res) => {
  if (!requireActiveCompany(req, res)) return;
  const rows = listDrives({ companyAddress: req.user.address });
  res.json({
    drives: rows.map((d) =>
      serializeDrive(d, {
        collegeName: getActor(d.college_address)?.name ?? null,
        // What the platform has recorded, next to what the company has attested.
        // A gap between them is the company's cue to publish the figure.
        applicationsReceived: countApplications(d.id),
      })
    ),
  });
});

/**
 * Publishes how many applied. Company-only, on-chain.
 * @dev Separate from the row count above because that count belongs to the
 *      platform — and the platform is run by the college whose conversion rate
 *      the number shapes. The published figure is the one the company signs.
 */
drivesRouter.post("/:id/application-count", issueLimiter, async (req, res) => {
  if (!requireActiveCompany(req, res)) return;

  const driveId = Number(req.params.id);
  const drive = getDrive(driveId);
  if (!drive) return res.status(404).json({ error: "No such drive." });
  if (drive.company_address.toLowerCase() !== req.user.address.toLowerCase()) {
    return res.status(403).json({ error: "That isn't your drive." });
  }

  // Defaults to what the platform actually recorded, so the ordinary case is
  // confirming a real number rather than typing one in.
  const raw = req.body?.count;
  const count = raw === undefined || raw === null || raw === "" ? countApplications(driveId) : Number(raw);
  if (!Number.isInteger(count) || count < 0 || count > 1e6) {
    return res.status(400).json({ error: "Application count must be a whole number up to 1000000." });
  }

  try {
    const receipt = await withWalletLock(req.user.address, async (nonce) => {
      const drives = placementDriveAsSigner(getUserSigner(req.user.id));
      const tx = await drives.recordApplicationCount(driveId, count, { nonce });
      return tx.wait();
    });
    const args = findEventInReceipt(placementDriveRead, "ApplicationCountRecorded", receipt);
    if (args) syncApplicationCount(args, receipt);

    logger.info("application_count_recorded", { driveId, count, company: req.user.address });
    res.json({ txHash: receipt.hash, applicationCount: count });
  } catch (err) {
    const reason = err.reason || err.shortMessage || err.message;
    res.status(400).json({ error: `On-chain update failed: ${reason}` });
  }
});

async function changeDriveStatus(req, res, method, event) {
  if (!requireActiveCompany(req, res)) return;
  const driveId = Number(req.params.id);
  const drive = getDrive(driveId);
  if (!drive) return res.status(404).json({ error: "No such drive." });
  if (drive.company_address.toLowerCase() !== req.user.address.toLowerCase()) {
    return res.status(403).json({ error: "That isn't your drive." });
  }

  try {
    const receipt = await withWalletLock(req.user.address, async (nonce) => {
      const drives = placementDriveAsSigner(getUserSigner(req.user.id));
      const tx = await drives[method](driveId, { nonce });
      return tx.wait();
    });
    const args = findEventInReceipt(placementDriveRead, "DriveStatusChanged", receipt);
    if (args) syncDriveStatus(args, receipt);
    logger.info(event, { driveId, company: req.user.address });
    res.json({ drive: serializeDrive(getDrive(driveId)), txHash: receipt.hash });
  } catch (err) {
    const reason = err.reason || err.shortMessage || err.message;
    res.status(400).json({ error: `On-chain update failed: ${reason}` });
  }
}

drivesRouter.post("/:id/close", (req, res) => changeDriveStatus(req, res, "closeDrive", "drive_closed"));
drivesRouter.post("/:id/cancel", (req, res) => changeDriveStatus(req, res, "cancelDrive", "drive_cancelled"));

/** Who applied, with the profile detail a recruiter needs to shortlist. */
drivesRouter.get("/:id/applicants", (req, res) => {
  const driveId = Number(req.params.id);
  const drive = getDrive(driveId);
  if (!drive) return res.status(404).json({ error: "No such drive." });

  const caller = getActor(req.user.address);
  const isOwner = drive.company_address.toLowerCase() === req.user.address.toLowerCase();
  const isHost = drive.college_address.toLowerCase() === req.user.address.toLowerCase();
  if (!caller || (!isOwner && !isHost)) {
    return res.status(403).json({ error: "Not allowed to view this drive's applicants." });
  }

  const stages = new Map(getCurrentStages(driveId).map((s) => [s.student_address.toLowerCase(), s]));
  res.json({
    applicants: listApplicants(driveId).map((a) => {
      const stage = stages.get(a.student_address.toLowerCase());
      return {
        address: a.student_address,
        rollNumber: a.roll_number,
        fullName: a.full_name,
        courseCode: a.course_code,
        batchYear: a.batch_year,
        cgpa: a.cgpa_scaled === null || a.cgpa_scaled === undefined ? null : a.cgpa_scaled / 100,
        appliedAt: a.applied_at,
        stage: stage ? STAGE_NAMES[stage.stage] : null,
        stageLabel: stage?.label ?? null,
      };
    }),
  });
});

// ============================================================================
// Students: browsing and applying
// ============================================================================

/**
 * Open drives a student can see, each annotated with whether they may apply.
 * @dev Eligibility is returned with its reason rather than as a bare flag: a
 *      student turned away is owed the specific cutoff they missed. The criteria
 *      were published on-chain before applications opened, so this is checking
 *      against something the company committed to publicly.
 */
drivesRouter.get("/open", (req, res) => {
  const actor = getActor(req.user.address);
  const isVerifiedStudent = !!actor && actor.role === ROLE.Student && actor.status === STATUS.Active;

  // An unverified account sees everything and can act on nothing. Refusing the
  // listing outright was the wall this redesign exists to remove: a student who
  // signed up before the roster was uploaded could not even find out which
  // companies were coming.
  if (!isVerifiedStudent) {
    const colleges = listActors({ role: ROLE.College, status: STATUS.Active });
    if (colleges.length === 0) return res.json({ verified: false, drives: [] });

    const rows = listDrives({ collegeAddress: colleges[0].address, status: DRIVE_STATUS.Approved });
    return res.json({
      verified: false,
      drives: rows.map((d) =>
        serializeDrive(d, {
          companyName: getActor(d.company_address)?.name ?? null,
          eligible: false,
          ineligibleReason: "Verify your roll number before you can apply.",
          applied: false,
        })
      ),
    });
  }

  const profile = getProfile(req.user.address);
  const rows = listDrives({ collegeAddress: actor.college, status: DRIVE_STATUS.Approved });

  res.json({
    verified: true,
    drives: rows.map((d) => {
      const eligibility = checkEligibility(profile, d);
      return serializeDrive(d, {
        companyName: getActor(d.company_address)?.name ?? null,
        eligible: eligibility.eligible,
        ineligibleReason: eligibility.reason,
        applied: hasApplied(d.id, req.user.address),
      });
    }),
  });
});

drivesRouter.post("/:id/apply", (req, res) => {
  const actor = getActor(req.user.address);
  if (!actor || actor.role !== ROLE.Student) {
    return res.status(403).json({ error: "Only a registered student can apply." });
  }

  const driveId = Number(req.params.id);
  const drive = getDrive(driveId);
  if (!drive) return res.status(404).json({ error: "No such drive." });
  if (drive.college_address.toLowerCase() !== String(actor.college ?? "").toLowerCase()) {
    return res.status(403).json({ error: "That drive isn't running at your college." });
  }
  if (drive.status !== DRIVE_STATUS.Approved) {
    return res.status(409).json({ error: "That drive isn't open for applications." });
  }
  if (drive.application_deadline * 1000 < Date.now()) {
    return res.status(409).json({ error: "Applications for this drive have closed." });
  }

  const eligibility = checkEligibility(getProfile(req.user.address), drive);
  if (!eligibility.eligible) {
    return res.status(403).json({ error: eligibility.reason });
  }

  if (!addApplication(driveId, req.user.address)) {
    return res.status(409).json({ error: "You have already applied to this drive." });
  }

  logger.info("application_submitted", { driveId, student: req.user.address });
  res.status(201).json({ applied: true });
});

/** A student's own applications, with where each currently stands. */
drivesRouter.get("/my-applications", (req, res) => {
  const actor = getActor(req.user.address);
  // Not an error for an unverified account — they simply have none yet.
  if (!actor || actor.role !== ROLE.Student) {
    return res.json({ applications: [] });
  }

  res.json({
    applications: listApplicationsForStudent(req.user.address).map((a) => {
      const stages = getCurrentStages(a.drive_id);
      const mine = stages.find((s) => s.student_address.toLowerCase() === req.user.address.toLowerCase());
      const response = getOfferResponse(a.drive_id, req.user.address);
      return {
        driveId: a.drive_id,
        roleTitle: a.role_title,
        annualPackage: a.annual_package,
        driveDate: a.drive_date,
        companyName: getActor(a.company_address)?.name ?? null,
        appliedAt: a.applied_at,
        stage: mine ? STAGE_NAMES[mine.stage] : "Applied",
        stageLabel: mine?.label ?? null,
        // An offer needs an answer, and only the student can give it.
        awaitingResponse: !!mine && mine.stage === STAGE.Offered && !response,
      };
    }),
  });
});
