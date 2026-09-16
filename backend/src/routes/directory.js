import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  getActor,
  getProfile,
  lookupStudent,
  listResumeItems,
  listSkills,
} from "../db.js";
import { ROLE, STATUS } from "../chain.js";
import { serializeProfile } from "../studentProfile.js";
import { serializeResume } from "../serializers.js";
import { logger } from "../logger.js";

/**
 * directory.js — students looking each other up.
 *
 * Classmates are not strangers, so a student may see another student's full
 * profile. What they may not do is enumerate the batch: the lookup takes a roll
 * number **and** an email, and both must match the same person.
 *
 * That pair is a weak secret — college emails are often derivable from roll
 * numbers — and pretending otherwise would be the mistake here. It is treated
 * as what it is: a lookup key, not an authorisation. The rate limit below is
 * doing at least as much work as the pair itself, and is the reason a script
 * cannot walk the roster one number at a time.
 */
export const directoryRouter = Router();

/**
 * Twenty lookups per fifteen minutes.
 *
 * Comfortably more than anyone finding a few classmates needs, and far too few
 * to crawl a batch of 180 — which takes 180 successful lookups, and would take
 * over two hours of sustained hammering to even attempt.
 */
const lookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many lookups. Please try again in a little while." },
});

/**
 * Only a verified student of this college may look one up.
 *
 * An unverified account is refused, because otherwise the roll-number check
 * would be protecting nothing: anyone could sign up with any email and read
 * every profile in the college.
 */
function requireVerifiedStudent(req, res, next) {
  const actor = getActor(req.user.address);
  if (!actor || actor.role !== ROLE.Student || actor.status !== STATUS.Active) {
    return res.status(403).json({
      error: "Verify your roll number before looking up other students.",
    });
  }
  req.actor = actor;
  next();
}

directoryRouter.use(requireVerifiedStudent);

/**
 * Finds one classmate by roll number and email.
 *
 * A miss and a wrong-college hit answer identically — otherwise the difference
 * between "no such roll number" and "that email is wrong" would confirm which
 * roll numbers exist, which is the thing requiring the pair is meant to avoid.
 */
directoryRouter.post("/lookup", lookupLimiter, (req, res) => {
  const { rollNumber, email } = req.body || {};
  if (!rollNumber || !email) {
    return res.status(400).json({ error: "Enter both a roll number and an email." });
  }

  const college = req.actor.college;
  const found = lookupStudent(college, String(rollNumber).trim().toUpperCase(), email);
  if (!found) {
    logger.info("directory_lookup_miss", { by: req.user.address });
    return res.status(404).json({
      error: "No student matches that roll number and email.",
    });
  }

  res.json({
    student: {
      ...serializeProfile(found),
      email: found.email,
      resume: serializeResume(listResumeItems(found.address)),
      skills: listSkills(found.address).map((s) => s.display),
    },
  });
});

/**
 * A student's own view of their college's directory shape — nothing
 * identifying, just what exists, so the lookup form can say "2026, CSE" rather
 * than asking someone to guess.
 */
directoryRouter.get("/me", (req, res) => {
  const profile = getProfile(req.user.address);
  res.json({
    collegeAddress: req.actor.college,
    batchYear: profile?.batch_year ?? null,
    courseCode: profile?.course_code ?? null,
  });
});
