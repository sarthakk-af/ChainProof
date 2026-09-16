import { Router } from "express";
import {
  getActor,
  listActors,
  getDrive,
  AUDIENCE,
  createAnnouncement,
  getAnnouncement,
  getAnnouncementWithContext,
  updateAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
} from "../db.js";
import { ROLE, STATUS } from "../chain.js";
import { serializeAnnouncement } from "../serializers.js";
import { logger } from "../logger.js";

/**
 * announcements.js — placement notices.
 *
 * The only editable, deletable surface on this platform, and deliberately so.
 * "The interview moved to Hall B, bring two copies" is operational: it changes,
 * it gets corrected, it is stale in a week. The drive it refers to is already
 * on-chain and permanent, so the announcement is never the record — the thing
 * it is about already is.
 *
 * Who may post: the college, and any company the college has admitted. A
 * company may only announce about its own drives, which keeps a notice from
 * becoming a way to say something about a drive you do not own.
 *
 * Nothing here is placement-adjacent filler. It is a placement feed, not a
 * noticeboard — anything else belongs in whatever the college already uses.
 */
export const announcementsRouter = Router();

const MAX_TITLE = 140;
const MAX_BODY = 4000;

/** This build hosts one college; every notice belongs to it. */
function theCollege() {
  return listActors({ role: ROLE.College, status: STATUS.Active })[0] ?? null;
}

function parseAnnouncementBody(input) {
  const title = String(input?.title ?? "").trim().replace(/\s+/g, " ");
  if (!title) return { error: "A title is required." };
  if (Buffer.byteLength(title, "utf8") > MAX_TITLE) {
    return { error: `The title must be ${MAX_TITLE} bytes or fewer.` };
  }

  const body = String(input?.body ?? "")
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!body) return { error: "Say something in the notice." };
  if (Buffer.byteLength(body, "utf8") > MAX_BODY) {
    return { error: `The notice must be ${MAX_BODY} bytes or fewer.` };
  }

  const audience = input?.audience === AUDIENCE.Public ? AUDIENCE.Public : AUDIENCE.Students;
  return { values: { title, body, audience } };
}

/**
 * The feed a signed-in account sees.
 *
 * Students see everything posted at their college. A company sees the same
 * feed — it is how a recruiter learns the college has moved a slot — which is
 * fine, because a notice is not personal data.
 */
announcementsRouter.get("/", (req, res) => {
  const actor = getActor(req.user.address);
  const college = actor?.role === ROLE.College ? actor : theCollege();
  if (!college) return res.json({ announcements: [] });

  const mine = req.query.mine === "true";
  const rows = listAnnouncements(college.address, {
    authorAddress: mine ? req.user.address : undefined,
  });
  res.json({ announcements: rows.map(serializeAnnouncement) });
});

/**
 * Posts a notice.
 *
 * A company must name one of its own drives. That is not bureaucracy: without
 * it, "announcement" becomes a channel for a company to say whatever it likes
 * about a college it has no relationship with, and the college — whose platform
 * this is — has no say in what appears on it.
 */
announcementsRouter.post("/", (req, res) => {
  const actor = getActor(req.user.address);
  if (!actor || actor.status !== STATUS.Active) {
    return res.status(403).json({ error: "Only the college or an approved company can post." });
  }
  if (actor.role !== ROLE.College && actor.role !== ROLE.Company) {
    return res.status(403).json({ error: "Students cannot post announcements." });
  }

  const parsed = parseAnnouncementBody(req.body || {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  let collegeAddress;
  let driveId = null;

  if (actor.role === ROLE.College) {
    collegeAddress = actor.address;
    if (req.body?.driveId !== undefined && req.body?.driveId !== null) {
      const drive = getDrive(Number(req.body.driveId));
      if (!drive || drive.college_address.toLowerCase() !== actor.address.toLowerCase()) {
        return res.status(404).json({ error: "No such drive at this college." });
      }
      driveId = drive.id;
    }
  } else {
    if (req.body?.driveId === undefined || req.body?.driveId === null) {
      return res.status(400).json({
        error: "Choose which of your drives this notice is about.",
      });
    }
    const drive = getDrive(Number(req.body.driveId));
    if (!drive || drive.company_address.toLowerCase() !== actor.address.toLowerCase()) {
      return res.status(403).json({ error: "You can only post about your own drives." });
    }
    collegeAddress = drive.college_address;
    driveId = drive.id;
  }

  const row = createAnnouncement({
    authorAddress: actor.address,
    authorRole: actor.role,
    collegeAddress,
    driveId,
    ...parsed.values,
  });

  logger.info("announcement_posted", { id: row.id, by: actor.address, driveId });
  res.status(201).json({ announcement: serializeAnnouncement(getAnnouncementWithContext(row.id)) });
});

/**
 * Edits a notice.
 * @dev The edit is stamped, never silent — see db/announcements.js. A notice
 *      rewritten after people have acted on it is the one failure mode an
 *      editable feed has, and saying so costs nothing.
 */
announcementsRouter.patch("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid notice id." });

  const parsed = parseAnnouncementBody(req.body || {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  if (!updateAnnouncement(id, req.user.address, parsed.values)) {
    return res.status(404).json({ error: "No such notice of yours." });
  }
  res.json({ announcement: serializeAnnouncement(getAnnouncementWithContext(id)) });
});

/** Withdraws a notice. A tombstone, not a delete. */
announcementsRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid notice id." });
  if (!deleteAnnouncement(id, req.user.address)) {
    return res.status(404).json({ error: "No such notice of yours." });
  }
  res.json({ deleted: true });
});
