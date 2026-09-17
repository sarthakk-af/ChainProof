import { ROLE, STATUS, DRIVE_STATUS, STAGE, OFFER_RESPONSE } from "./chain.js";

const ROLE_NAMES = Object.fromEntries(Object.entries(ROLE).map(([k, v]) => [v, k]));
const STATUS_NAMES = Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [v, k]));

const DRIVE_STATUS_NAMES = Object.fromEntries(
  Object.entries(DRIVE_STATUS).map(([k, v]) => [v, k])
);
const STAGE_NAMES = Object.fromEntries(Object.entries(STAGE).map(([k, v]) => [v, k]));
const OFFER_RESPONSE_NAMES = Object.fromEntries(
  Object.entries(OFFER_RESPONSE).map(([k, v]) => [v, k])
);

export { ROLE_NAMES, STATUS_NAMES, DRIVE_STATUS_NAMES, STAGE_NAMES, OFFER_RESPONSE_NAMES };

export function serializeActor(row) {
  return {
    address: row.address,
    role: ROLE_NAMES[row.role],
    status: STATUS_NAMES[row.status],
    name: row.name,
    website: row.metadata || null,
    // Tri-state: null = no website given (or not checked yet), true/false =
    // whether a live HTTP probe at registration time actually got a response.
    websiteReachable: row.website_reachable === null || row.website_reachable === undefined
      ? null
      : Boolean(row.website_reachable),
    // Public on purpose, same reasoning as website: a CIN/accreditation ID
    // is meant to be independently checkable (e.g. against India's MCA
    // registry for a CIN), not a secret — showing it is what makes it useful
    // as public evidence rather than just admin-only paperwork.
    registrationNumber: row.registration_number || null,
    college: row.college,
    registeredAtBlock: row.registered_at_block,
    updatedAtBlock: row.updated_at_block,
    rejectionReason: row.rejection_reason || null,
    rejectionCount: row.rejection_count || 0,
  };
}

/**
 * A drive as the API returns it.
 * @dev Money is sent as whole rupees and CGPA unscaled, so the frontend never
 *      has to know that CGPA is stored x100 — that scaling exists to make
 *      cutoff comparisons exact, and is an implementation detail of storage.
 */
export function serializeDrive(row, extra = {}) {
  return {
    id: row.id,
    companyAddress: row.company_address,
    collegeAddress: row.college_address,
    roleTitle: row.role_title,
    annualPackage: row.annual_package,
    minCgpa: row.min_cgpa_scaled ? row.min_cgpa_scaled / 100 : null,
    batchYear: row.batch_year,
    applicationDeadline: row.application_deadline,
    driveDate: row.drive_date,
    ipfsHash: row.ipfs_hash,
    status: DRIVE_STATUS_NAMES[row.status] ?? "Unknown",
    // null, not 0: the company has not stated the figure yet, which is a
    // different fact from "nobody applied".
    applicationCount: row.application_count ?? null,
    ...extra,
  };
}

/** One stage a company recorded, as the API returns it. */
export function serializeOutcome(row) {
  return {
    driveId: row.drive_id,
    stage: STAGE_NAMES[row.stage] ?? "Unknown",
    previousStage: STAGE_NAMES[row.previous_stage] ?? null,
    label: row.label || null,
    ipfsHash: row.ipfs_hash || null,
    timestamp: row.timestamp,
  };
}

/** One resume entry, as the API returns it. */
export function serializeResumeItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    subtitle: row.subtitle || null,
    startedOn: row.started_on || null,
    endedOn: row.ended_on || null,
    description: row.description || null,
    url: row.url || null,
    position: row.position,
  };
}

/** A whole resume: every section, in display order, sections included when empty. */
export function serializeResume(grouped) {
  const out = {};
  for (const [kind, rows] of Object.entries(grouped)) {
    out[kind] = rows.map(serializeResumeItem);
  }
  return out;
}

/**
 * A student as a company browsing the pool may see them.
 *
 * @dev No name, no email, no phone — enough to judge a candidate, not enough to
 *      contact one. A company that wants to reach a student posts a drive and
 *      waits for them to apply; that is the whole reason the college sits in
 *      the middle. The fields are simply never selected from the database (see
 *      db/directory.js), so this cannot be defeated by forgetting a line here.
 */
export function serializeTalentCard(row, skills = []) {
  return {
    rollNumber: row.roll_number,
    courseCode: row.course_code,
    batchYear: row.batch_year,
    cgpa: row.cgpa_scaled === null || row.cgpa_scaled === undefined ? null : row.cgpa_scaled / 100,
    headline: row.headline || null,
    placed: !!row.is_placed,
    skills,
  };
}

/** One preparation event the college recorded, as the API returns it. */
export function serializePreparationEvent(row, kindLabels) {
  return {
    id: row.id,
    kind: kindLabels[row.kind] ?? "Other",
    title: row.title,
    conductedBy: row.conducted_by,
    heldOn: row.held_on,
    attendance: row.attendance,
    batchYear: row.batch_year || null,
    ipfsHash: row.ipfs_hash || null,
    cancelled: !!row.cancelled,
    cancelReason: row.cancel_reason || null,
    // The block timestamp, not the claimed date. Published deliberately: a
    // record written as the year went is a different statement from one
    // assembled afterwards, and only this field can tell them apart.
    recordedAt: row.recorded_at,
  };
}

/** One placement notice. */
export function serializeAnnouncement(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    audience: row.audience,
    authorAddress: row.author_address,
    authorName: row.author_name || null,
    authorRole: ROLE_NAMES[row.author_role] ?? null,
    driveId: row.drive_id ?? null,
    driveRoleTitle: row.drive_role_title || null,
    createdAt: row.created_at,
    // Present only when the notice was rewritten after publishing. The one
    // editable surface here says so rather than editing silently.
    editedAt: row.edited_at ?? null,
  };
}
