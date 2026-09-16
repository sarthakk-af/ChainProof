import { Router } from "express";
import {
  getActor,
  getUserById,
  clearRejectionReason,
  setWebsiteReachable,
  setRegistrationNumber,
  claimRegistrationNumber,
  releaseClaimsForAddress,
  getRosterEntry,
  claimRosterEntry,
  releaseRosterClaim,
  getRosterEntryForAddress,
  upsertProfile,
  patchProfile,
  getProfile,
  getVerification,
  VERIFICATION,
  addResumeItem,
  getResumeItem,
  updateResumeItem,
  deleteResumeItem,
  reorderResumeItems,
  listResumeItems,
  setSkills,
  listSkills,
} from "../db.js";
import { getUserSigner } from "../wallets.js";
import { actorRegistryAsSigner, ROLE, STATUS } from "../chain.js";
import { syncActor } from "../indexer.js";
import { withWalletLock } from "../txQueue.js";
import { serializeActor } from "../serializers.js";
import { validateWebsiteFormat, checkWebsiteReachable } from "../websiteCheck.js";
import { validateRegistrationNumber } from "../registrationNumber.js";
import { byteLength, MAX_NAME_BYTES, MAX_METADATA_BYTES } from "../limits.js";
import { claimRollNumber, verificationState } from "../studentVerification.js";
import {
  ROSTER_FIELDS,
  SELF_FIELDS,
  parseField,
  parseFields,
  serializeProfile,
  describeFields,
  publicKey,
} from "../studentProfile.js";
import {
  RESUME_KIND_KEYS,
  parseResumeItem,
  parseSkills,
  describeResumeSections,
} from "../resume.js";
import { serializeResume, serializeResumeItem } from "../serializers.js";
import { registerLimiter } from "../middleware/chainWriteLimiter.js";
import { logger } from "../logger.js";

export const meRouter = Router();

meRouter.get("/", (req, res) => {
  const user = getUserById(req.user.id);
  const actorRow = getActor(req.user.address);
  res.json({
    email: user.email,
    address: req.user.address,
    actor: actorRow ? serializeActor(actorRow) : null,
    profile: serializeProfile(getProfile(req.user.address)),
    // Everything the interface needs to tell someone exactly what is still
    // outstanding, rather than leaving them to guess why a button is disabled.
    verification: verificationState(user),
  });
});

/**
 * A student's claim to a roll number.
 *
 * Verifies them outright if the roster already lists it, and queues them for
 * the placement cell if it doesn't. Both orderings work, which is the entire
 * point: the previous build only handled the first and made the second a wall.
 */
meRouter.post("/claim-roll-number", registerLimiter, async (req, res) => {
  const { collegeAddress, rollNumber, ...profileInput } = req.body || {};
  if (!collegeAddress) {
    return res.status(400).json({ error: "Choose your college." });
  }

  const result = await claimRollNumber({
    userId: req.user.id,
    collegeAddress,
    rollNumber,
    profileInput,
  });
  if (result.error) return res.status(400).json({ error: result.error });

  const user = getUserById(req.user.id);
  res.status(result.matched ? 200 : 202).json({
    matched: !!result.matched,
    queued: !!result.queued,
    verification: verificationState(user),
    profile: serializeProfile(getProfile(req.user.address)),
  });
});

/**
 * The profile field list, so the frontend renders whatever is declared rather
 * than a hard-coded form. The list is expected to grow; this is what keeps
 * "add a field" a single edit in src/studentProfile.js.
 */
meRouter.get("/profile-fields", (_req, res) => {
  res.json({ fields: describeFields(SELF_FIELDS) });
});

/**
 * Resolves the profile a student may write to, creating the empty row if the
 * claim exists but nothing has been written to it yet.
 *
 * Deliberately does NOT require an on-chain actor. A student waiting for the
 * placement cell to approve their roll number is exactly the person with time
 * to fill in a resume, and telling them to come back once someone else has
 * acted would rebuild the dead end this version exists to remove. What it does
 * require is a claimed roll number — without one there is no college to attach
 * a profile to, and no reason to believe this account is a student at all.
 *
 * @returns {{profile: Object}|{error: string}}
 */
function studentProfileFor(address, userId) {
  const existing = getProfile(address);
  if (existing) return { profile: existing };

  const request = getVerification(userId);
  if (!request || request.status === VERIFICATION.Rejected) {
    return { error: "Claim your roll number before filling in your profile." };
  }
  upsertProfile(address, request.college_address, {});
  return { profile: getProfile(address) };
}

/**
 * Updates the fields a student fills in themselves.
 * @dev Roster fields are deliberately absent: name, roll number, course and
 *      batch come from the college's own list, and letting a student edit them
 *      would undo the only thing that establishes they belong here.
 */
meRouter.patch("/profile", (req, res) => {
  const gate = studentProfileFor(req.user.address, req.user.id);
  if (gate.error) return res.status(403).json({ error: gate.error });

  const values = {};
  for (const spec of SELF_FIELDS) {
    const key = publicKey(spec);
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, key)) continue;
    const result = parseField(spec.column, req.body[key]);
    if (result.error) return res.status(400).json({ error: result.error });
    values[spec.column] = result.value;
  }
  if (Object.keys(values).length === 0) {
    return res.status(400).json({ error: "Nothing to update." });
  }

  patchProfile(req.user.address, values);
  res.json({ profile: serializeProfile(getProfile(req.user.address)) });
});

// ===========================================================================
// The resume
// ===========================================================================

/**
 * The section list, so the frontend renders whatever is declared rather than a
 * hard-coded form — same reasoning as /me/profile-fields.
 */
meRouter.get("/resume-sections", (_req, res) => {
  res.json({ sections: describeResumeSections() });
});

/** Everything a student has written about themselves. */
meRouter.get("/resume", (req, res) => {
  res.json({
    resume: serializeResume(listResumeItems(req.user.address)),
    skills: listSkills(req.user.address).map((s) => s.display),
  });
});

/**
 * Adds one entry to a section.
 * @dev Nothing here is verified by anyone, and that is the design: a resume
 *      changes constantly and a false claim surfaces at the interview. The
 *      platform guarantees the placement record, not the resume.
 */
meRouter.post("/resume/:kind", (req, res) => {
  const gate = studentProfileFor(req.user.address, req.user.id);
  if (gate.error) return res.status(403).json({ error: gate.error });

  const { kind } = req.params;
  const parsed = parseResumeItem(kind, req.body || {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const result = addResumeItem(req.user.address, parsed.values);
  if (result.error) return res.status(409).json({ error: result.error });
  res.status(201).json({ item: serializeResumeItem(result.item) });
});

/** Rewrites one entry. */
meRouter.patch("/resume/item/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid entry id." });

  // Read first only to learn which section it belongs to — the update itself is
  // still scoped by owner, so a guessed id changes nothing either way.
  const existing = getResumeItem(id);
  if (!existing || existing.address !== req.user.address.toLowerCase()) {
    return res.status(404).json({ error: "No such entry." });
  }

  const parsed = parseResumeItem(existing.kind, req.body || {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  if (!updateResumeItem(id, req.user.address, parsed.values)) {
    return res.status(404).json({ error: "No such entry." });
  }
  res.json({ item: serializeResumeItem(getResumeItem(id)) });
});

meRouter.delete("/resume/item/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid entry id." });
  if (!deleteResumeItem(id, req.user.address)) {
    return res.status(404).json({ error: "No such entry." });
  }
  res.json({ deleted: true });
});

/** Reorders one section. Ids that aren't the caller's are simply ignored. */
meRouter.post("/resume/:kind/reorder", (req, res) => {
  const { kind } = req.params;
  if (!RESUME_KIND_KEYS.includes(kind)) {
    return res.status(400).json({ error: `Unknown section: "${kind}".` });
  }
  const { order } = req.body || {};
  if (!Array.isArray(order) || order.some((id) => !Number.isInteger(id))) {
    return res.status(400).json({ error: "order must be a list of entry ids." });
  }

  reorderResumeItems(req.user.address, kind, order);
  res.json({ resume: serializeResume(listResumeItems(req.user.address)) });
});

/**
 * Replaces the whole skill list.
 * @dev A replace rather than a merge, because the form sends the complete list
 *      and a merge would leave no way to remove one.
 */
meRouter.put("/skills", (req, res) => {
  const gate = studentProfileFor(req.user.address, req.user.id);
  if (gate.error) return res.status(403).json({ error: gate.error });

  const parsed = parseSkills(req.body?.skills);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  setSkills(req.user.address, parsed.values);
  res.json({ skills: listSkills(req.user.address).map((s) => s.display) });
});

/**
 * Registers a Company on-chain.
 *
 * Only a Company. A College is created by the platform admin at setup — the
 * platform belongs to the college, and an internal tool does not ask its owner
 * to sign up for it. A Student is written on-chain only once verified, by
 * studentVerification.js, so that someone who signs up and never returns costs
 * no gas and never lands in the registered-student count.
 */
meRouter.post("/register", registerLimiter, async (req, res) => {
  const { role, name, website, registrationNumber } = req.body || {};

  if (role === "Student") {
    return res.status(400).json({
      error: "Students are verified by roll number — use /me/claim-roll-number.",
    });
  }
  if (role === "College") {
    return res.status(403).json({
      error: "The college is set up by the platform administrator, not registered here.",
    });
  }
  if (role !== "Company") {
    return res.status(400).json({ error: `Invalid role: "${role}". Expected Company.` });
  }
  const roleNumber = ROLE.Company;

  const existing = getActor(req.user.address);
  if (existing && existing.status !== STATUS.Rejected) {
    return res.status(409).json({ error: "This account is already registered on-chain" });
  }

  const companyName = String(name ?? "").trim();
  if (!companyName) {
    return res.status(400).json({ error: "Company name is required" });
  }
  if (byteLength(companyName) > MAX_NAME_BYTES) {
    return res.status(400).json({ error: `name must be ${MAX_NAME_BYTES} bytes or fewer` });
  }

  const websiteCheck = validateWebsiteFormat(website);
  if (websiteCheck.error) return res.status(400).json({ error: websiteCheck.error });
  if (byteLength(websiteCheck.value) > MAX_METADATA_BYTES) {
    return res.status(400).json({ error: `Website URL must be ${MAX_METADATA_BYTES} bytes or fewer` });
  }
  const normalizedWebsite = websiteCheck.value;

  const regCheck = validateRegistrationNumber("Company", registrationNumber);
  if (regCheck.error) return res.status(400).json({ error: regCheck.error });
  const normalizedRegistrationNumber = regCheck.value;

  releaseClaimsForAddress(req.user.address);
  if (!claimRegistrationNumber(normalizedRegistrationNumber, req.user.address)) {
    return res.status(409).json({
      error: "That CIN is already registered to another account. A company can only be registered once.",
    });
  }

  const ALREADY_REGISTERED = Symbol("already-registered");

  try {
    await withWalletLock(req.user.address, async (nonce) => {
      // Re-read under the lock: the check above runs before queuing, so two
      // requests fired together both pass it and the loser pays gas to revert.
      const current = getActor(req.user.address);
      if (current && current.status !== STATUS.Rejected) throw ALREADY_REGISTERED;

      const registry = actorRegistryAsSigner(getUserSigner(req.user.id));
      const tx = await registry.register(
        roleNumber,
        companyName,
        normalizedWebsite,
        "0x0000000000000000000000000000000000000000",
        { nonce }
      );
      const receipt = await tx.wait();
      await syncActor(req.user.address, receipt.blockNumber);
      clearRejectionReason(req.user.address);
    });

    setRegistrationNumber(req.user.address, normalizedRegistrationNumber);
    logger.info("company_registered", { address: req.user.address, name: companyName });
    res.status(201).json({ actor: serializeActor(getActor(req.user.address)) });

    if (normalizedWebsite) {
      checkWebsiteReachable(normalizedWebsite)
        .then((reachable) => setWebsiteReachable(req.user.address, reachable))
        .catch(() => {});
    } else {
      setWebsiteReachable(req.user.address, null);
    }
  } catch (err) {
    if (err === ALREADY_REGISTERED) {
      return res.status(409).json({ error: "This account is already registered on-chain" });
    }
    // Nothing reached the chain, so don't leave the CIN locked away from the
    // company it actually belongs to.
    releaseClaimsForAddress(req.user.address);
    const reason = err.reason || err.shortMessage || err.message;
    logger.error("registration_failed", { address: req.user.address, reason });
    res.status(400).json({ error: `On-chain registration failed: ${reason}` });
  }
});

/** What the roster says about this account, if it claimed a row. */
meRouter.get("/roster-entry", (req, res) => {
  const entry = getRosterEntryForAddress(req.user.address);
  if (!entry) return res.status(404).json({ error: "No roster entry claimed by this account." });
  res.json({
    rollNumber: entry.roll_number,
    fullName: entry.full_name,
    courseCode: entry.course_code,
    batchYear: entry.batch_year,
    collegeAddress: entry.college_address,
  });
});
