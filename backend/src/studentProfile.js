/**
 * studentProfile.js — the single declaration of what a student profile holds.
 *
 * This list is expected to change as the product gets clearer, so everything
 * that depends on it is derived from here rather than restating it: the
 * database migration, request validation, the roster upload parser, and the
 * eligibility rules. Adding a field should be one edit in this file, not five
 * edits in five files that then quietly drift apart.
 *
 * Affordable precisely because profiles are off-chain. On a chain, every change
 * would be a migration and every old record would keep the old shape forever —
 * which is also why none of this is written there. A student is a wallet
 * address on-chain and a person only here.
 */

/**
 * @typedef {Object} FieldSpec
 * @property {string} column      SQLite column name.
 * @property {string} [key]       Name used by the API and the frontend. Defaults to
 *   the camelCased column. Set it explicitly where the column name carries a
 *   storage detail the outside world should not have to know — `cgpa_scaled` is
 *   stored x100 so cutoff comparisons are exact, but a client sends and receives
 *   a plain `cgpa` of 7.85.
 * @property {string} label       Human label, used in errors and by the frontend.
 * @property {"text"|"integer"|"decimal2"} type
 *   `decimal2` is stored as an integer scaled by 100 — CGPA 7.85 is 785. Stored
 *   that way because a placement cutoff is a comparison, and binary floating
 *   point makes "7.00 >= 7.00" a coin toss at the boundary.
 * @property {boolean} required   Whether registration may proceed without it.
 * @property {boolean} fromRoster Whether the college supplies it, not the student.
 * @property {number} [maxBytes]  For text fields.
 * @property {number} [min]       For numeric fields, inclusive.
 * @property {number} [max]       For numeric fields, inclusive.
 * @property {RegExp} [pattern]   For text fields.
 * @property {boolean} [preserveCase] Text fields with a pattern are upper-cased,
 *   so "cse" and "CSE" are one course rather than two. A URL is the opposite
 *   case — path segments are case-sensitive, and upper-casing one breaks the
 *   link — so those opt out.
 * @property {boolean} [multiline] Ordinary text collapses all whitespace to
 *   single spaces. A paragraph field must not: collapsing it would run every
 *   line of an "about" section into one. Newlines survive; runs of blank lines
 *   are squeezed to one, and other control characters are dropped.
 * @property {string} [help]      Shown to the user when the value is rejected.
 */

/**
 * Links a student may add to their profile.
 *
 * `http` and `https` only, deliberately: a profile link is rendered as an
 * anchor someone will click, and `javascript:` in an href is the oldest
 * cross-site scripting trick there is. Restricting the scheme here means the
 * frontend never has to remember to check.
 */
const URL_PATTERN = /^https?:\/\/[^\s<>"']{3,}$/;

/** @type {FieldSpec[]} */
export const STUDENT_FIELDS = [
  {
    column: "roll_number",
    label: "Roll number",
    type: "text",
    required: true,
    fromRoster: true,
    maxBytes: 32,
    pattern: /^[A-Z0-9][A-Z0-9/\-]{2,31}$/,
    help: "Letters, digits, / and - only.",
  },
  {
    column: "full_name",
    label: "Full name",
    type: "text",
    required: true,
    fromRoster: true,
    maxBytes: 100,
    help: "As it appears on college records.",
  },
  {
    column: "course_code",
    label: "Course",
    type: "text",
    required: true,
    fromRoster: true,
    maxBytes: 20,
    pattern: /^[A-Z0-9][A-Z0-9\-]{1,19}$/,
    help: "Short course code, e.g. CSE or MECH-B.",
  },
  {
    column: "batch_year",
    label: "Batch year",
    type: "integer",
    required: true,
    fromRoster: true,
    min: 2000,
    max: 2100,
    help: "The year this batch graduates.",
  },
  {
    column: "cgpa_scaled",
    key: "cgpa",
    label: "CGPA",
    type: "decimal2",
    required: false,
    fromRoster: false,
    min: 0,
    max: 1000,
    help: "Between 0.00 and 10.00.",
  },
  {
    column: "phone",
    label: "Phone",
    type: "text",
    required: false,
    fromRoster: false,
    maxBytes: 20,
    pattern: /^[0-9+\-() ]{6,20}$/,
    help: "Digits, spaces and + - ( ) only.",
  },
  {
    column: "headline",
    label: "Headline",
    type: "text",
    required: false,
    fromRoster: false,
    maxBytes: 120,
    help: "One line, e.g. \"Final-year CSE student - backend and databases\".",
  },
  {
    column: "about",
    label: "About",
    type: "text",
    required: false,
    fromRoster: false,
    maxBytes: 1500,
    multiline: true,
    help: "A short paragraph about yourself.",
  },
  {
    column: "hobbies",
    label: "Interests and hobbies",
    type: "text",
    required: false,
    fromRoster: false,
    maxBytes: 300,
  },
  {
    column: "github_url",
    label: "GitHub",
    type: "text",
    required: false,
    fromRoster: false,
    maxBytes: 200,
    pattern: URL_PATTERN,
    preserveCase: true,
    help: "A full link, starting with https://",
  },
  {
    column: "linkedin_url",
    label: "LinkedIn",
    type: "text",
    required: false,
    fromRoster: false,
    maxBytes: 200,
    pattern: URL_PATTERN,
    preserveCase: true,
    help: "A full link, starting with https://",
  },
  {
    column: "portfolio_url",
    label: "Portfolio or website",
    type: "text",
    required: false,
    fromRoster: false,
    maxBytes: 200,
    pattern: URL_PATTERN,
    preserveCase: true,
    help: "A full link, starting with https://",
  },
];

/** Fields the college supplies when it uploads a roster. */
export const ROSTER_FIELDS = STUDENT_FIELDS.filter((f) => f.fromRoster);

/** Fields a student fills in themselves, after claiming their roll number. */
export const SELF_FIELDS = STUDENT_FIELDS.filter((f) => !f.fromRoster);

const BY_COLUMN = new Map(STUDENT_FIELDS.map((f) => [f.column, f]));

/** The SQLite column definitions for these fields, in declaration order. */
export function columnDefinitions() {
  return STUDENT_FIELDS.map((f) => {
    const sqlType = f.type === "text" ? "TEXT" : "INTEGER";
    return `${f.column} ${sqlType}`;
  });
}

function byteLength(value) {
  return Buffer.byteLength(String(value ?? ""), "utf8");
}

/**
 * Tidies a paragraph without flattening it.
 *
 * Every other text field collapses whitespace, which is right for a name and
 * wrong for an "about" section — it would run the whole thing into a single
 * line. Line breaks survive here; carriage returns are normalised away, runs of
 * blank lines are squeezed to one, and other control characters are dropped,
 * because a newline is the only one of them a profile needs and the rest only
 * ever arrive by paste accident or on purpose.
 */
function normalizeParagraph(raw) {
  return raw
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Parses and validates one field's raw input.
 * @returns {{value: *}|{error: string}}
 */
export function parseField(column, raw) {
  const spec = BY_COLUMN.get(column);
  if (!spec) return { error: `Unknown field: ${column}` };

  const isBlank = raw === undefined || raw === null || String(raw).trim() === "";
  if (isBlank) {
    if (spec.required) return { error: `${spec.label} is required.` };
    return { value: null };
  }

  if (spec.type === "text") {
    // Upper-cased where a pattern expects it, so "cse" and "CSE" are one course
    // rather than two — the same normalisation reasoning as registration numbers.
    // URLs opt out: a path segment is case-sensitive and upper-casing one turns
    // a working link into a 404.
    const trimmed = spec.multiline
      ? normalizeParagraph(String(raw))
      : String(raw).trim().replace(/\s+/g, " ");
    const value = spec.pattern && !spec.preserveCase ? trimmed.toUpperCase() : trimmed;
    if (spec.maxBytes && byteLength(value) > spec.maxBytes) {
      return { error: `${spec.label} must be ${spec.maxBytes} bytes or fewer.` };
    }
    if (spec.pattern && !spec.pattern.test(value)) {
      return { error: `${spec.label} isn't in the expected format. ${spec.help || ""}`.trim() };
    }
    return { value };
  }

  if (spec.type === "integer") {
    const value = Number(raw);
    if (!Number.isInteger(value)) return { error: `${spec.label} must be a whole number.` };
    if (spec.min !== undefined && value < spec.min) {
      return { error: `${spec.label} must be at least ${spec.min}.` };
    }
    if (spec.max !== undefined && value > spec.max) {
      return { error: `${spec.label} must be at most ${spec.max}.` };
    }
    return { value };
  }

  // decimal2 — accepted as a human decimal, stored scaled by 100.
  const asNumber = Number(raw);
  if (!Number.isFinite(asNumber)) {
    return { error: `${spec.label} must be a number.` };
  }
  const value = Math.round(asNumber * 100);
  if (spec.min !== undefined && value < spec.min) {
    return { error: `${spec.label} must be at least ${spec.min / 100}.` };
  }
  if (spec.max !== undefined && value > spec.max) {
    return { error: `${spec.label} must be at most ${spec.max / 100}.` };
  }
  return { value };
}

/**
 * Validates a whole submission against a set of fields.
 * @returns {{values: Object}|{error: string}}
 */
export function parseFields(fields, input) {
  const values = {};
  for (const spec of fields) {
    const key = publicKey(spec);
    const result = parseField(spec.column, input?.[key] ?? input?.[spec.column]);
    if (result.error) return { error: result.error };
    values[spec.column] = result.value;
  }
  return { values };
}

/** `roll_number` -> `rollNumber`, the shape the API and frontend use. */
export function toInputKey(column) {
  return column.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/** The name this field goes by outside the database. */
export function publicKey(spec) {
  return spec.key ?? toInputKey(spec.column);
}

/** Turns a database row into the camelCase object the API returns. */
export function serializeProfile(row) {
  if (!row) return null;
  const out = {};
  for (const spec of STUDENT_FIELDS) {
    const raw = row[spec.column];
    out[publicKey(spec)] =
      spec.type === "decimal2" && raw !== null && raw !== undefined ? raw / 100 : raw ?? null;
  }
  return out;
}

/**
 * The field list in a form the frontend can render without hard-coding it.
 * Regexes are sent as strings so the browser can build its own RegExp.
 */
export function describeFields(fields = STUDENT_FIELDS) {
  return fields.map((f) => ({
    key: publicKey(f),
    label: f.label,
    type: f.type,
    required: f.required,
    fromRoster: f.fromRoster,
    maxBytes: f.maxBytes ?? null,
    min: f.type === "decimal2" && f.min !== undefined ? f.min / 100 : f.min ?? null,
    max: f.type === "decimal2" && f.max !== undefined ? f.max / 100 : f.max ?? null,
    pattern: f.pattern ? f.pattern.source : null,
    multiline: !!f.multiline,
    help: f.help ?? null,
  }));
}
