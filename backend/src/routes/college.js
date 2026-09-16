import { Router } from "express";
import { ethers } from "ethers";
import {
  getActor,
  listActors,
  upsertRosterEntries,
  listRoster,
  rosterCounts,
  listPendingVerifications,
  upsertBatch,
  listBatches,
  getDrive,
  listDrives,
  logAdminAction,
  listAdminActions,
  EVENT_KIND,
  EVENT_KIND_LABELS,
  listPreparationEvents,
  preparationSummary,
  getPreparationEvent,
} from "../db.js";
import { getUserSigner } from "../wallets.js";
import {
  actorRegistryAsSigner,
  placementDriveAsSigner,
  preparationLogAsSigner,
  ROLE,
  STATUS,
  DRIVE_STATUS,
} from "../chain.js";
import {
  syncActor,
  syncBatchStrength,
  syncDriveStatus,
  syncPreparationRecorded,
  syncPreparationCancelled,
} from "../indexer.js";
import { findEventInReceipt } from "../indexer.js";
import { placementDriveRead, actorRegistryRead, preparationLogRead } from "../chain.js";
import { withWalletLock } from "../txQueue.js";
import {
  serializeActor,
  serializeDrive,
  serializePreparationEvent,
  STATUS_NAMES,
} from "../serializers.js";
import { ROSTER_FIELDS, parseFields, publicKey } from "../studentProfile.js";
import { approveQueuedStudent, rejectQueuedStudent } from "../studentVerification.js";
import { registerLimiter, recordLimiter } from "../middleware/chainWriteLimiter.js";
import { logger } from "../logger.js";

/**
 * college.js — everything the placement cell does.
 *
 * In v2 the college account *is* the administrator: there is no separate
 * platform admin and no shared secret behind these routes. What matters is the
 * boundary this router keeps — the college admits companies, hosts drives,
 * lists its own students and declares its cohort sizes, and writes nothing that
 * belongs to anybody else. Every route here is a gate, never an authorship.
 */
export const collegeRouter = Router();

/** Every route below requires an Active College. */
function requireActiveCollege(req, res) {
  const actor = getActor(req.user.address);
  if (!actor || actor.role !== ROLE.College || actor.status !== STATUS.Active) {
    res.status(403).json({ error: "Only a verified college can do this." });
    return null;
  }
  return actor;
}

collegeRouter.use((req, res, next) => {
  if (!requireActiveCollege(req, res)) return;
  next();
});

// ============================================================================
// Roster — the college's own list of who its students are
// ============================================================================

/**
 * The field list for a roster row, so the frontend and any CSV template are
 * generated from src/studentProfile.js rather than restating it.
 */
collegeRouter.get("/roster/fields", (_req, res) => {
  res.json({
    fields: ROSTER_FIELDS.map((f) => ({
      key: publicKey(f),
      label: f.label,
      required: f.required,
      help: f.help ?? null,
    })),
  });
});

/**
 * Uploads or updates roster rows.
 * @dev Each row is validated individually and the whole upload is reported back
 *      row by row. A single bad line in a 180-row paste must not throw the
 *      other 179 away, and "row 42: batch year must be at least 2000" is
 *      actionable in a way that "invalid roster" is not.
 */
collegeRouter.post("/roster", (req, res) => {
  const { entries } = req.body || {};
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: "Provide an `entries` array." });
  }
  if (entries.length > 5000) {
    return res.status(400).json({ error: "Upload at most 5000 rows at a time." });
  }

  const parsed = [];
  const errors = [];
  const seen = new Set();

  entries.forEach((entry, index) => {
    const result = parseFields(ROSTER_FIELDS, entry);
    if (result.error) {
      errors.push({ row: index + 1, error: result.error });
      return;
    }
    const roll = result.values.roll_number;
    if (seen.has(roll)) {
      errors.push({ row: index + 1, error: `Duplicate roll number in this upload: ${roll}` });
      return;
    }
    seen.add(roll);
    parsed.push(result.values);
  });

  if (errors.length > 0) {
    // Nothing is written when any row is bad: a half-applied roster is worse
    // than none, because it looks complete.
    return res.status(400).json({ error: `${errors.length} row(s) could not be read.`, errors });
  }

  const result = upsertRosterEntries(req.user.address, parsed);
  logger.info("roster_uploaded", {
    college: req.user.address,
    added: result.added,
    updated: result.updated,
    skipped: result.skipped.length,
  });
  res.json({
    added: result.added,
    updated: result.updated,
    // Rows already claimed by a real account are left alone: rewriting the name
    // or course under someone would silently change who their account says
    // they are.
    skippedClaimed: result.skipped,
  });
});

collegeRouter.get("/roster", (req, res) => {
  const batchYear = req.query.batchYear ? Number(req.query.batchYear) : null;
  const rows = listRoster(req.user.address, { batchYear });
  res.json({
    roster: rows.map((r) => ({
      rollNumber: r.roll_number,
      fullName: r.full_name,
      courseCode: r.course_code,
      batchYear: r.batch_year,
      claimed: !!r.claimed_by,
      claimedAt: r.claimed_at,
    })),
    counts: rosterCounts(req.user.address),
  });
});

// ============================================================================
// Students waiting to be verified
// ============================================================================

/**
 * Students whose roll number wasn't on the roster when they signed up.
 *
 * This queue is the answer to the ordering problem: a student who arrives
 * before the roster does now waits here instead of being told no. Left empty,
 * it means the roster is doing its job and everyone matched automatically.
 */
collegeRouter.get("/verifications", (req, res) => {
  res.json({
    pending: listPendingVerifications(req.user.address).map((v) => ({
      userId: v.user_id,
      email: v.email,
      rollNumber: v.roll_number,
      requestedAt: v.created_at,
    })),
  });
});

collegeRouter.post("/verifications/:userId/approve", async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId)) {
    return res.status(400).json({ error: "Invalid user id" });
  }

  // Approving creates the roster row this student was claiming against, so the
  // roster stays the single record of who belongs here rather than approval
  // becoming a second, quieter way in. The cell therefore has to supply the
  // same details a roster upload would.
  const parsed = parseFields(
    ROSTER_FIELDS.filter((f) => f.column !== "roll_number"),
    req.body || {}
  );
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const result = await approveQueuedStudent({
    userId,
    collegeAddress: req.user.address,
    rosterDetails: parsed.values,
  });
  if (result.error) return res.status(400).json({ error: result.error });

  logger.info("student_verification_approved", { userId, college: req.user.address });
  res.json({ approved: true, onChain: !!result.completed });
});

collegeRouter.post("/verifications/:userId/reject", (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId)) {
    return res.status(400).json({ error: "Invalid user id" });
  }
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : "";

  const result = rejectQueuedStudent({ userId, collegeAddress: req.user.address, reason });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ rejected: true });
});

// ============================================================================
// Preparation — what the college did to get students ready
// ============================================================================

/**
 * The kinds of activity that can be recorded, so the form is generated rather
 * than restated. Mirrors PreparationLog.EventKind.
 */
collegeRouter.get("/events/kinds", (_req, res) => {
  res.json({
    kinds: Object.entries(EVENT_KIND_LABELS).map(([value, label]) => ({
      value: Number(value),
      key: Object.keys(EVENT_KIND).find((k) => EVENT_KIND[k] === Number(value)),
      label,
    })),
  });
});

/**
 * Records one preparation activity on-chain.
 *
 * Every other record here holds the college to account for results. This is the
 * one where it is the author rather than the subject — its own evidence of
 * effort. The trade is that it is permanent: there is no edit route below,
 * deliberately, because a record of effort that can be topped up in June is not
 * evidence of anything.
 */
collegeRouter.post("/events", recordLimiter, async (req, res) => {
  const { kind, title, conductedBy, heldOn, attendance, batchYear, ipfsHash } = req.body || {};

  const kindValue = typeof kind === "string" ? EVENT_KIND[kind] : Number(kind);
  if (!kindValue || !EVENT_KIND_LABELS[kindValue]) {
    return res.status(400).json({
      error: `Choose a kind: ${Object.values(EVENT_KIND_LABELS).join(", ")}.`,
    });
  }

  const titleText = String(title ?? "").trim().replace(/\s+/g, " ");
  if (!titleText || Buffer.byteLength(titleText, "utf8") > 120) {
    return res.status(400).json({ error: "A title of 1-120 bytes is required." });
  }
  const conductedByText = String(conductedBy ?? "").trim().replace(/\s+/g, " ");
  if (!conductedByText || Buffer.byteLength(conductedByText, "utf8") > 100) {
    return res.status(400).json({ error: "Say who conducted it (1-100 bytes)." });
  }

  const held = Number(heldOn);
  if (!Number.isInteger(held) || held <= 0) {
    return res.status(400).json({ error: "A date is required." });
  }
  // The contract enforces this too — it has to, since anyone can call it
  // directly — but refusing here means a typo costs a form error rather than a
  // failed transaction and a revert message nobody can read.
  const oneYearAhead = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  if (held > oneYearAhead) {
    return res.status(400).json({ error: "That date is more than a year away — check it." });
  }

  const attended = attendance === undefined || attendance === null ? 0 : Number(attendance);
  if (!Number.isInteger(attended) || attended < 0 || attended > 100000) {
    return res.status(400).json({ error: "Attendance must be between 0 and 100000." });
  }

  const year = batchYear === undefined || batchYear === null || batchYear === "" ? 0 : Number(batchYear);
  if (!Number.isInteger(year) || (year !== 0 && (year < 2000 || year > 2100))) {
    return res.status(400).json({ error: "Batch year must be between 2000 and 2100, or blank for all." });
  }

  const cid = String(ipfsHash ?? "").trim();
  if (Buffer.byteLength(cid, "utf8") > 200) {
    return res.status(400).json({ error: "That document reference is too long." });
  }

  try {
    const receipt = await withWalletLock(req.user.address, async (nonce) => {
      const log = preparationLogAsSigner(getUserSigner(req.user.id));
      const tx = await log.recordEvent(
        kindValue,
        titleText,
        conductedByText,
        held,
        attended,
        year,
        cid,
        { nonce }
      );
      return tx.wait();
    });

    const args = findEventInReceipt(preparationLogRead, "PreparationRecorded", receipt);
    if (args) await syncPreparationRecorded(args, receipt);

    logger.info("preparation_recorded", { college: req.user.address, title: titleText });
    res.status(201).json({
      txHash: receipt.hash,
      events: listPreparationEvents(req.user.address).map((r) =>
        serializePreparationEvent(r, EVENT_KIND_LABELS)
      ),
    });
  } catch (err) {
    const reason = err.reason || err.shortMessage || err.message;
    logger.error("preparation_record_failed", { college: req.user.address, reason });
    res.status(400).json({ error: `On-chain update failed: ${reason}` });
  }
});

/** The college's own preparation record, cancelled entries included. */
collegeRouter.get("/events", (req, res) => {
  const batchYear = req.query.batchYear ? Number(req.query.batchYear) : undefined;
  res.json({
    events: listPreparationEvents(req.user.address, { batchYear }).map((r) =>
      serializePreparationEvent(r, EVENT_KIND_LABELS)
    ),
    summary: preparationSummary(req.user.address, { batchYear }),
  });
});

/**
 * States that a recorded activity did not happen.
 *
 * The only way back from a wrong entry, and it costs something: the original
 * stays on the record beside the cancellation, so recording ten sessions and
 * calling off nine is as visible as the sessions themselves.
 */
collegeRouter.post("/events/:id/cancel", recordLimiter, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 0) {
    return res.status(400).json({ error: "Invalid event id." });
  }
  const existing = getPreparationEvent(id);
  if (!existing || existing.college_address.toLowerCase() !== req.user.address.toLowerCase()) {
    return res.status(404).json({ error: "No such event of yours." });
  }
  if (existing.cancelled) {
    return res.status(409).json({ error: "That event is already cancelled." });
  }

  const reason = String(req.body?.reason ?? "").trim().replace(/\s+/g, " ").slice(0, 200);

  try {
    const receipt = await withWalletLock(req.user.address, async (nonce) => {
      const log = preparationLogAsSigner(getUserSigner(req.user.id));
      const tx = await log.cancelEvent(id, reason, { nonce });
      return tx.wait();
    });

    const args = findEventInReceipt(preparationLogRead, "PreparationCancelled", receipt);
    if (args) syncPreparationCancelled(args, receipt);

    logger.info("preparation_cancelled", { college: req.user.address, id, reason });
    res.json({ txHash: receipt.hash, cancelled: true });
  } catch (err) {
    const reason2 = err.reason || err.shortMessage || err.message;
    logger.error("preparation_cancel_failed", { college: req.user.address, id, reason: reason2 });
    res.status(400).json({ error: `On-chain update failed: ${reason2}` });
  }
});

// ============================================================================
// Cohort sizes — the denominator, declared on-chain
// ============================================================================

/**
 * Declares or revises a cohort's size.
 * @dev Goes on-chain deliberately. This is the one number the college itself
 *      supplies and the one most worth inflating by shrinking — so every
 *      revision is permanent and carries its previous value.
 */
collegeRouter.post("/batches", registerLimiter, async (req, res) => {
  const { courseCode, batchYear, strength } = req.body || {};
  const code = String(courseCode ?? "").trim().toUpperCase();
  const year = Number(batchYear);
  const size = Number(strength);

  if (!code || code.length > 20) {
    return res.status(400).json({ error: "A course code of 1-20 characters is required." });
  }
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return res.status(400).json({ error: "Batch year must be between 2000 and 2100." });
  }
  if (!Number.isInteger(size) || size < 1 || size > 100000) {
    return res.status(400).json({ error: "Batch strength must be between 1 and 100000." });
  }

  try {
    const receipt = await withWalletLock(req.user.address, async (nonce) => {
      const registry = actorRegistryAsSigner(getUserSigner(req.user.id));
      const tx = await registry.recordBatchStrength(code, year, size, { nonce });
      return tx.wait();
    });

    const args = findEventInReceipt(actorRegistryRead, "BatchStrengthRecorded", receipt);
    if (args) syncBatchStrength(args, receipt);

    logger.info("batch_strength_recorded", { college: req.user.address, code, year, size });
    res.status(201).json({ txHash: receipt.hash, batches: listBatches(req.user.address) });
  } catch (err) {
    const reason = err.reason || err.shortMessage || err.message;
    logger.error("batch_strength_failed", { college: req.user.address, reason });
    res.status(400).json({ error: `On-chain update failed: ${reason}` });
  }
});

collegeRouter.get("/batches", (req, res) => {
  const rows = listBatches(req.user.address);
  res.json({
    batches: rows.map((b) => ({
      courseCode: b.course_code,
      batchYear: b.batch_year,
      strength: b.strength,
      previousStrength: b.previous_strength,
      revisionCount: b.revision_count,
    })),
  });
});

// ============================================================================
// Admitting companies — the college decides who recruits on its campus
// ============================================================================

collegeRouter.get("/companies", (req, res) => {
  const status = req.query.status ? Number(req.query.status) : undefined;
  const rows = listActors({ role: ROLE.Company, status });
  res.json({ companies: rows.map(serializeActor) });
});

async function decideCompany(req, res, { method, event, expectedStatus, reason }) {
  const { address } = req.params;
  if (!ethers.isAddress(address)) {
    return res.status(400).json({ error: "Invalid company address" });
  }
  const company = getActor(address);
  if (!company || company.role !== ROLE.Company) {
    return res.status(404).json({ error: "No such company." });
  }
  if (company.status !== STATUS.Pending) {
    return res.status(409).json({
      error: `That company is not awaiting a decision (current status: ${STATUS_NAMES[company.status]}).`,
    });
  }

  const ALREADY_DECIDED = Symbol("already-decided");
  try {
    const receipt = await withWalletLock(req.user.address, async (nonce) => {
      // Re-read inside the lock — two clicks at the same instant would both
      // pass the check above, and the loser would pay gas to revert.
      const current = getActor(address);
      if (!current || current.status !== STATUS.Pending) throw ALREADY_DECIDED;
      const registry = actorRegistryAsSigner(getUserSigner(req.user.id));
      const tx = await registry[method](address, { nonce });
      return tx.wait();
    });

    await syncActor(address, receipt.blockNumber);
    logAdminAction({
      actorAddress: address,
      actorName: company.name,
      action: event,
      reason: reason || null,
      txHash: receipt.hash,
      adminUsername: getActor(req.user.address)?.name || req.user.address,
    });
    logger.info(event, { company: address, by: req.user.address });
    res.json({ company: serializeActor(getActor(address)), txHash: receipt.hash });
  } catch (err) {
    if (err === ALREADY_DECIDED) {
      const now = getActor(address);
      return res.status(409).json({
        error: `Already decided (current status: ${now ? STATUS_NAMES[now.status] : "unknown"}).`,
      });
    }
    const reason2 = err.reason || err.shortMessage || err.message;
    logger.error("company_decision_failed", { company: address, reason: reason2 });
    res.status(502).json({ error: `On-chain transaction failed: ${reason2}` });
  }
}

collegeRouter.post("/companies/:address/approve", (req, res) =>
  decideCompany(req, res, { method: "approveActor", event: "company_approved" })
);

collegeRouter.post("/companies/:address/reject", (req, res) =>
  decideCompany(req, res, {
    method: "rejectActor",
    event: "company_rejected",
    reason: typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : "",
  })
);

// ============================================================================
// Hosting drives — approve or decline what a company proposed
// ============================================================================

collegeRouter.get("/drives", (req, res) => {
  const status = req.query.status ? Number(req.query.status) : undefined;
  const rows = listDrives({ collegeAddress: req.user.address, status });
  res.json({
    drives: rows.map((d) => {
      const company = getActor(d.company_address);
      return serializeDrive(d, { companyName: company?.name ?? null });
    }),
  });
});

async function decideDrive(req, res, { method, event }) {
  const driveId = Number(req.params.id);
  if (!Number.isInteger(driveId) || driveId < 0) {
    return res.status(400).json({ error: "Invalid drive id" });
  }
  const drive = getDrive(driveId);
  if (!drive) return res.status(404).json({ error: "No such drive." });
  if (drive.college_address.toLowerCase() !== req.user.address.toLowerCase()) {
    return res.status(403).json({ error: "That drive was not proposed to your college." });
  }
  if (drive.status !== DRIVE_STATUS.Proposed) {
    return res.status(409).json({ error: "That drive is no longer awaiting a decision." });
  }

  const ALREADY_DECIDED = Symbol("already-decided");
  try {
    const receipt = await withWalletLock(req.user.address, async (nonce) => {
      const current = getDrive(driveId);
      if (!current || current.status !== DRIVE_STATUS.Proposed) throw ALREADY_DECIDED;
      const drives = placementDriveAsSigner(getUserSigner(req.user.id));
      const tx = await drives[method](driveId, { nonce });
      return tx.wait();
    });

    const args = findEventInReceipt(placementDriveRead, "DriveStatusChanged", receipt);
    if (args) syncDriveStatus(args, receipt);

    logger.info(event, { driveId, college: req.user.address });
    res.json({ drive: serializeDrive(getDrive(driveId)), txHash: receipt.hash });
  } catch (err) {
    if (err === ALREADY_DECIDED) {
      return res.status(409).json({ error: "That drive is no longer awaiting a decision." });
    }
    const reason = err.reason || err.shortMessage || err.message;
    logger.error("drive_decision_failed", { driveId, reason });
    res.status(502).json({ error: `On-chain transaction failed: ${reason}` });
  }
}

collegeRouter.post("/drives/:id/approve", (req, res) =>
  decideDrive(req, res, { method: "approveDrive", event: "drive_approved" })
);

collegeRouter.post("/drives/:id/reject", (req, res) =>
  decideDrive(req, res, { method: "rejectDrive", event: "drive_rejected" })
);

/** The permanent record of every decision this college has made. */
collegeRouter.get("/decisions", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json({ decisions: listAdminActions(limit) });
});
