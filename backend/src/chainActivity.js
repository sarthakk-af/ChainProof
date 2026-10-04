import { getActor, getDrive, EVENT_KIND_LABELS } from "./db.js";
import { ROLE, DRIVE_STATUS, STAGE, OFFER_RESPONSE } from "./chain.js";

/**
 * chainActivity.js — what each mirrored chain event is about, in plain words.
 *
 * Two halves. `activityFields` runs as the indexer mirrors an event and keeps
 * the few arguments needed to describe it later. `describeActivity` turns a
 * stored row into a sentence for the public "recent activity" feed on the
 * How-it-works page.
 *
 * The feed is public, so it follows the rule the rest of the public pages
 * keep (see routes/public.js): no individual appears. A student is only ever
 * "a student" — no name, no address — and a drive the public pages don't show
 * yet, or a decision against someone, is described without naming anyone.
 * The transaction link carries everything else, on the public chain itself.
 */

/** Drives the public pages show; anything else is described without its title. */
const PUBLIC_DRIVE_STATUSES = new Set([
  DRIVE_STATUS.Approved,
  DRIVE_STATUS.Closed,
  DRIVE_STATUS.Cancelled,
]);

const STAGE_NAMES = Object.fromEntries(Object.entries(STAGE).map(([name, n]) => [n, name]));

/**
 * The address an event is about, the drive it concerns, and the arguments
 * worth keeping, by event name. An event not listed here is still logged,
 * just without details.
 */
export function activityFields(event, args) {
  switch (event) {
    case "ActorRegistered":
      return { subject: args[0], details: { role: Number(args[1]) } };
    case "ActorApproved":
    case "ActorRejected":
    case "ActorSuspended":
    case "ActorReinstated":
      return { subject: args[0] };
    case "BatchStrengthRecorded":
      return {
        subject: args[0],
        details: {
          course: args[1],
          batchYear: Number(args[2]),
          previous: Number(args[3]),
          strength: Number(args[4]),
        },
      };
    case "DrivePosted":
      return { subject: args[1], driveId: Number(args[0]) };
    case "DriveStatusChanged":
      return { subject: args[3], driveId: Number(args[0]), details: { status: Number(args[2]) } };
    case "ApplicationCountRecorded":
      return { subject: args[1], driveId: Number(args[0]), details: { count: Number(args[3]) } };
    case "StageRecorded":
      return { subject: args[1], driveId: Number(args[0]), details: { stage: Number(args[4]) } };
    case "OfferAnswered":
      return { subject: args[1], driveId: Number(args[0]), details: { response: Number(args[2]) } };
    case "PlacementChanged":
      return {
        subject: args[0],
        details: { placed: Boolean(args[3]), batchYear: Number(args[2]) },
      };
    case "PreparationRecorded":
      return {
        subject: args[1],
        details: { eventId: Number(args[0]), kind: Number(args[2]), title: args[3] },
      };
    case "PreparationCancelled":
      return { subject: args[1], details: { eventId: Number(args[0]) } };
    default:
      return {};
  }
}

/** A public name for an account: the college's and companies', never a student's. */
function publicName(address, fallback) {
  const actor = address ? getActor(address) : null;
  if (!actor || actor.role === ROLE.Student) return fallback;
  return actor.name || fallback;
}

/** "the drive “SDE Intern”" when the public pages show it, "a drive" otherwise. */
function driveName(driveId) {
  const drive = driveId === null || driveId === undefined ? null : getDrive(driveId);
  if (!drive || !PUBLIC_DRIVE_STATUSES.has(drive.status)) return "a drive";
  return `the drive “${drive.role_title}”`;
}

function companyOf(driveId) {
  const drive = driveId === null || driveId === undefined ? null : getDrive(driveId);
  if (!drive || !PUBLIC_DRIVE_STATUSES.has(drive.status)) return "A company";
  return publicName(drive.company_address, "A company");
}

/**
 * One sentence for a stored activity row, or null for an event the feed skips:
 * a drive's move to Proposed, which always arrives in the same transaction as
 * the DrivePosted it would only repeat.
 */
export function describeActivity(row) {
  const d = row.details ?? {};
  switch (row.event) {
    case "ActorRegistered": {
      if (d.role === ROLE.College) return `${publicName(row.subject, "The college")} was set up as the college`;
      if (d.role === ROLE.Company) return `${publicName(row.subject, "A company")} registered as a recruiter`;
      if (d.role === ROLE.Student) return "A student was verified and joined the record";
      return "An account was registered";
    }
    case "ActorApproved": {
      const actor = getActor(row.subject);
      if (actor?.role === ROLE.Company) return `${publicName(row.subject, "A company")} was admitted by the college`;
      return "An account was approved";
    }
    case "ActorRejected":
      return "A registration was declined";
    case "ActorSuspended":
      return "An account was suspended";
    case "ActorReinstated":
      return "A suspended account was reinstated";
    case "BatchStrengthRecorded": {
      const cohort = `${d.course} ${d.batchYear}`;
      return d.previous > 0
        ? `The college revised its ${cohort} batch size from ${d.previous} to ${d.strength}`
        : `The college declared its ${cohort} batch: ${d.strength} students`;
    }
    case "DrivePosted":
      return `${companyOf(row.drive_id)} posted ${driveName(row.drive_id)}`;
    case "DriveStatusChanged": {
      if (d.status === DRIVE_STATUS.Proposed) return null;
      if (d.status === DRIVE_STATUS.Approved) return `The college approved ${driveName(row.drive_id)}`;
      if (d.status === DRIVE_STATUS.Rejected) return "The college declined a proposed drive";
      if (d.status === DRIVE_STATUS.Closed) return `${capitalise(driveName(row.drive_id))} closed`;
      if (d.status === DRIVE_STATUS.Cancelled) return `${capitalise(driveName(row.drive_id))} was cancelled`;
      return `${capitalise(driveName(row.drive_id))} changed status`;
    }
    case "ApplicationCountRecorded":
      return `${companyOf(row.drive_id)} recorded ${d.count} application${d.count === 1 ? "" : "s"} for ${driveName(row.drive_id)}`;
    case "StageRecorded": {
      const company = companyOf(row.drive_id);
      const drive = driveName(row.drive_id);
      if (d.stage === STAGE.Offered) return `${company} made an offer to a student in ${drive}`;
      if (d.stage === STAGE.NotSelected) return `${company} recorded a final result for a candidate in ${drive}`;
      const stage = (STAGE_NAMES[d.stage] ?? "a new stage").toLowerCase();
      return `${company} moved a candidate to ${stage} in ${drive}`;
    }
    case "OfferAnswered":
      return d.response === OFFER_RESPONSE.Accepted
        ? `A student accepted an offer in ${driveName(row.drive_id)}`
        : `A student declined an offer in ${driveName(row.drive_id)}`;
    case "PlacementChanged":
      return d.placed
        ? `A student in the ${d.batchYear} batch now counts as placed`
        : `A placement in the ${d.batchYear} batch was withdrawn`;
    case "PreparationRecorded": {
      const kind = (EVENT_KIND_LABELS[d.kind] ?? "session").toLowerCase();
      return `The college recorded a ${kind}: “${d.title}”`;
    }
    case "PreparationCancelled":
      return "The college marked a preparation session as not having happened";
    default:
      return `${row.event} recorded`;
  }
}

function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
