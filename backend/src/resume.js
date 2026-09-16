/**
 * resume.js — what a student may write about themselves.
 *
 * The counterpart to studentProfile.js. That file declares the single-value
 * fields a profile holds; this one declares the repeatable entries — projects,
 * internships, prior education, certifications, achievements — and the skills
 * a company can filter on.
 *
 * Everything here is **self-claimed and unverified, on purpose.** Nothing on
 * this platform checks that a student really interned where they say. A resume
 * changes constantly, so immortalising it on a chain would be absurd, and a
 * false claim is self-correcting: it surfaces in the interview and becomes that
 * student's problem. What the platform guarantees is not that a resume is true.
 * It is that the placement record is — and that record is written by whoever
 * would be embarrassed by the lie, which a resume never is.
 *
 * Kept in one module for the same reason as the profile fields: this list will
 * change, and validation, the API, and the form should all move when it does.
 */

/**
 * The kinds of entry a resume holds.
 *
 * One shape for all five, because they genuinely are the same shape — a title,
 * who it was with, when, what it was, and a link. Five near-identical tables
 * would have become five near-identical queries that drift apart.
 */
export const RESUME_KINDS = {
  experience: {
    label: "Internships & experience",
    titleLabel: "Role",
    subtitleLabel: "Organisation",
    help: "An internship, part-time role, or freelance work.",
  },
  project: {
    label: "Projects",
    titleLabel: "Project",
    subtitleLabel: "Built with / for",
    help: "Something you built. A link helps more than a description.",
  },
  education: {
    label: "Education",
    titleLabel: "Qualification",
    subtitleLabel: "Institution",
    help: "School and any qualification outside your current course.",
  },
  certification: {
    label: "Certifications",
    titleLabel: "Certification",
    subtitleLabel: "Issued by",
    help: "A course or exam you have a certificate for.",
  },
  achievement: {
    label: "Achievements",
    titleLabel: "Achievement",
    subtitleLabel: "Awarded by",
    help: "A competition, rank, scholarship or award.",
  },
};

export const RESUME_KIND_KEYS = Object.keys(RESUME_KINDS);

/**
 * Bounds on one entry.
 * @dev Enforced here rather than at the database, so a refusal can say which
 *      field was wrong and why instead of surfacing a constraint error.
 */
const MAX = {
  title: 120,
  subtitle: 120,
  description: 1000,
  url: 200,
  period: 20,
};

/**
 * How many entries one student may hold per kind.
 *
 * A limit exists because these rows are free to create and a profile is read by
 * other people; without one, a single account could store thousands of rows and
 * make every list that renders them unusable. Generous enough that no real
 * resume reaches it.
 */
export const MAX_ITEMS_PER_KIND = 25;

/** Same restriction as profile links: an href someone will click. */
const URL_PATTERN = /^https?:\/\/[^\s<>"']{3,}$/;

/**
 * A period is free text on purpose — "2024", "Jun 2024", "2023-2024",
 * "Present" are all things a student will reasonably type, and rejecting any of
 * them buys nothing. It is only bounded and stripped of control characters.
 */
function parsePeriod(raw, label) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return { value: null };
  const value = String(raw).trim().replace(/\s+/g, " ");
  if (Buffer.byteLength(value, "utf8") > MAX.period) {
    return { error: `${label} must be ${MAX.period} characters or fewer.` };
  }
  return { value };
}

function parseText(raw, { label, maxBytes, required = false, multiline = false }) {
  const isBlank = raw === undefined || raw === null || String(raw).trim() === "";
  if (isBlank) {
    if (required) return { error: `${label} is required.` };
    return { value: null };
  }
  let value = String(raw).replace(/\r\n?/g, "\n");
  // eslint-disable-next-line no-control-regex
  value = value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
  value = multiline
    ? value
        .split("\n")
        .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    : value.replace(/\s+/g, " ").trim();

  if (value === "") {
    if (required) return { error: `${label} is required.` };
    return { value: null };
  }
  if (Buffer.byteLength(value, "utf8") > maxBytes) {
    return { error: `${label} must be ${maxBytes} bytes or fewer.` };
  }
  return { value };
}

/**
 * Validates one resume entry submitted by a student.
 * @returns {{values: Object}|{error: string}}
 */
export function parseResumeItem(kind, input) {
  if (!RESUME_KIND_KEYS.includes(kind)) {
    return { error: `Unknown section: "${kind}".` };
  }
  const spec = RESUME_KINDS[kind];

  const title = parseText(input?.title, {
    label: spec.titleLabel,
    maxBytes: MAX.title,
    required: true,
  });
  if (title.error) return { error: title.error };

  const subtitle = parseText(input?.subtitle, {
    label: spec.subtitleLabel,
    maxBytes: MAX.subtitle,
  });
  if (subtitle.error) return { error: subtitle.error };

  const description = parseText(input?.description, {
    label: "Description",
    maxBytes: MAX.description,
    multiline: true,
  });
  if (description.error) return { error: description.error };

  const startedOn = parsePeriod(input?.startedOn, "Start");
  if (startedOn.error) return { error: startedOn.error };
  const endedOn = parsePeriod(input?.endedOn, "End");
  if (endedOn.error) return { error: endedOn.error };

  let url = null;
  const rawUrl = input?.url;
  if (rawUrl !== undefined && rawUrl !== null && String(rawUrl).trim() !== "") {
    url = String(rawUrl).trim();
    if (Buffer.byteLength(url, "utf8") > MAX.url) {
      return { error: `Link must be ${MAX.url} bytes or fewer.` };
    }
    if (!URL_PATTERN.test(url)) {
      return { error: "Link must be a full URL starting with https://" };
    }
  }

  return {
    values: {
      kind,
      title: title.value,
      subtitle: subtitle.value,
      started_on: startedOn.value,
      ended_on: endedOn.value,
      description: description.value,
      url,
    },
  };
}

/**
 * Bounds on the skill list.
 *
 * Capped because skills are the one part of a resume a company filters on: an
 * account listing four hundred of them would appear in every search, which is
 * exactly the incentive a limit removes.
 */
export const MAX_SKILLS = 40;
const MAX_SKILL_BYTES = 40;

/**
 * Turns what a student typed into the form used for matching.
 *
 * "React.js", "react js" and "REACT JS" are one skill to a recruiter and would
 * be three to a naive search, so the stored match key is lower-cased with
 * punctuation and spacing stripped. What they typed is kept separately and is
 * what gets displayed — normalising for search should not mean showing everyone
 * their own skills back in a flattened form.
 */
export function normalizeSkill(raw) {
  const display = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (display === "") return null;
  if (Buffer.byteLength(display, "utf8") > MAX_SKILL_BYTES) return null;
  const skill = display.toLowerCase().replace(/[^a-z0-9+#]/g, "");
  if (skill === "") return null;
  return { skill, display };
}

/**
 * Validates a whole skill list.
 * @returns {{values: Array<{skill: string, display: string}>}|{error: string}}
 */
export function parseSkills(input) {
  if (input === undefined || input === null) return { values: [] };
  if (!Array.isArray(input)) return { error: "Skills must be a list." };
  if (input.length > MAX_SKILLS) {
    return { error: `Please list at most ${MAX_SKILLS} skills.` };
  }

  const seen = new Map();
  for (const raw of input) {
    if (typeof raw !== "string") return { error: "Each skill must be text." };
    const normalized = normalizeSkill(raw);
    if (!normalized) {
      return { error: `"${String(raw).slice(0, 40)}" isn't a usable skill name.` };
    }
    // A duplicate is the student typing the same thing twice, not an error
    // worth stopping them for — the first spelling wins.
    if (!seen.has(normalized.skill)) seen.set(normalized.skill, normalized);
  }
  return { values: [...seen.values()] };
}

/** The section list in a form the frontend can render without hard-coding it. */
export function describeResumeSections() {
  return RESUME_KIND_KEYS.map((key) => ({
    key,
    label: RESUME_KINDS[key].label,
    titleLabel: RESUME_KINDS[key].titleLabel,
    subtitleLabel: RESUME_KINDS[key].subtitleLabel,
    help: RESUME_KINDS[key].help,
    maxItems: MAX_ITEMS_PER_KIND,
  }));
}
