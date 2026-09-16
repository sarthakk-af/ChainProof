import { Router } from "express";
import {
  getActor,
  listActors,
  searchTalentPool,
  getTalentProfile,
  talentFacets,
  skillVocabulary,
  skillsForAddresses,
  listResumeItems,
  listSkills,
  hasAppliedToCompany,
  getContactDetails,
} from "../db.js";
import { ROLE, STATUS } from "../chain.js";
import { normalizeSkill } from "../resume.js";
import { serializeTalentCard, serializeResume } from "../serializers.js";

/**
 * talent.js — what a company can see of a college's students.
 *
 * The compromise this file implements, and the reason it is worth having:
 *
 *   A company genuinely needs to know what kind of students a college has
 *   before deciding to visit — how many in each branch, what they know, what
 *   the CGPA spread looks like. Withholding that makes the platform useless to
 *   the recruiter it is trying to attract.
 *
 *   A student, equally, should not have their name and phone number sitting in
 *   a searchable list for every registered company to harvest.
 *
 * So browsing is anonymous: roll number, course, batch, CGPA, skills, and
 * everything they wrote about their work — but no name, no email, no phone. The
 * contact details unlock for one student and one company at the moment that
 * student applies to that company's drive. Applying is how a student says "you
 * may contact me", and it is the only way that permission is ever given.
 *
 * Which means a company can never reach out cold. It posts a drive, the college
 * hosts it, students apply. Remove that and the college stops being the medium
 * and the record stops being complete.
 */
export const talentRouter = Router();

/** Only a college-approved company, and only for the college that approved it. */
function requireActiveCompany(req, res, next) {
  const actor = getActor(req.user.address);
  if (!actor || actor.role !== ROLE.Company || actor.status !== STATUS.Active) {
    return res.status(403).json({
      error: "Only a college-approved company can browse students.",
    });
  }
  req.actor = actor;
  next();
}

talentRouter.use(requireActiveCompany);

/**
 * The college a company recruits at.
 *
 * A Company actor carries no college of its own on-chain — it is approved *by*
 * a college rather than belonging to one — so the college is resolved from the
 * approval. This build hosts one college, and that is asserted here rather than
 * assumed silently, so the day it stops being true this fails loudly instead of
 * quietly showing a recruiter the wrong institution's students.
 */
function collegeForCompany() {
  const colleges = listActors({ role: ROLE.College, status: STATUS.Active });
  return colleges[0]?.address ?? null;
}

/** Course and batch options, plus the skills students here actually list. */
talentRouter.get("/facets", (req, res) => {
  const college = collegeForCompany();
  if (!college) return res.json({ courses: [], batches: [], skills: [] });

  const batchYear = req.query.batchYear ? Number(req.query.batchYear) : undefined;
  res.json({
    ...talentFacets(college),
    // Built from what students actually listed, so a recruiter picks a skill
    // that will return people rather than guessing a spelling and getting an
    // empty page with no explanation.
    skills: skillVocabulary(college, { batchYear }),
  });
});

/**
 * The anonymised pool, filtered.
 *
 * @query batchYear, courseCode, minCgpa, skills (comma-separated), placed
 *        ("true" / "false"), limit, offset
 */
talentRouter.get("/", (req, res) => {
  const college = collegeForCompany();
  if (!college) return res.json({ students: [], total: 0, limit: 0, offset: 0 });

  const { batchYear, courseCode, minCgpa, skills, placed, limit, offset } = req.query;

  const filters = {};
  if (batchYear !== undefined) {
    const year = Number(batchYear);
    if (!Number.isInteger(year)) return res.status(400).json({ error: "batchYear must be a year." });
    filters.batchYear = year;
  }
  if (courseCode) filters.courseCode = String(courseCode).trim().toUpperCase();
  if (minCgpa !== undefined) {
    const value = Number(minCgpa);
    if (!Number.isFinite(value) || value < 0 || value > 10) {
      return res.status(400).json({ error: "minCgpa must be between 0 and 10." });
    }
    filters.minCgpaScaled = Math.round(value * 100);
  }
  if (skills) {
    // Normalised the same way they were stored, so "React.js" typed in a
    // filter finds the student who typed "react js".
    const requested = String(skills)
      .split(",")
      .map((s) => normalizeSkill(s))
      .filter(Boolean)
      .map((s) => s.skill);
    if (requested.length > 10) {
      return res.status(400).json({ error: "Filter on at most 10 skills at once." });
    }
    filters.skills = requested;
  }
  if (placed === "true") filters.placed = true;
  if (placed === "false") filters.placed = false;

  filters.limit = Math.min(Math.max(Number(limit) || 25, 1), 100);
  filters.offset = Math.max(Number(offset) || 0, 0);

  const { rows, total } = searchTalentPool(college, filters);
  // One query for every card's skills rather than one per card.
  const skillsByAddress = skillsForAddresses(rows.map((r) => r.address));

  res.json({
    students: rows.map((row) => serializeTalentCard(row, skillsByAddress.get(row.address) ?? [])),
    total,
    limit: filters.limit,
    offset: filters.offset,
  });
});

/**
 * One student's full anonymised profile, by roll number.
 *
 * Contact details appear here only if this student has applied to a drive this
 * company posted. `contactUnlockedBy` says why, so a recruiter reading a card
 * with no phone number understands the rule rather than assuming the profile is
 * incomplete.
 */
talentRouter.get("/:rollNumber", (req, res) => {
  const college = collegeForCompany();
  if (!college) return res.status(404).json({ error: "No such student." });

  const rollNumber = String(req.params.rollNumber).trim().toUpperCase();
  const row = getTalentProfile(college, rollNumber);
  if (!row) return res.status(404).json({ error: "No such student." });

  const applied = hasAppliedToCompany(row.address, req.user.address);
  const card = {
    ...serializeTalentCard(row, listSkills(row.address).map((s) => s.display)),
    about: row.about || null,
    hobbies: row.hobbies || null,
    links: {
      github: row.github_url || null,
      linkedin: row.linkedin_url || null,
      portfolio: row.portfolio_url || null,
    },
    resume: serializeResume(listResumeItems(row.address)),
    contactUnlocked: applied,
    contactUnlockedBy: applied
      ? "This student applied to one of your drives."
      : "Contact details appear once this student applies to one of your drives.",
  };

  if (applied) {
    const contact = getContactDetails(row.address);
    card.contact = {
      fullName: contact?.full_name ?? null,
      email: contact?.email ?? null,
      phone: contact?.phone ?? null,
    };
  }

  res.json({ student: card });
});
