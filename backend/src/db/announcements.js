import { db } from "./connection.js";

/**
 * announcements.js — placement notices, off-chain on purpose.
 *
 * "The interview moved to Hall B, bring two copies." It changes, it gets
 * corrected, it is stale in a week. The drive or preparation event it refers to
 * is already on-chain and permanent, so the announcement is never the record —
 * the thing it is about already is. Putting notices on a chain would mean
 * paying gas to immortalise a room number and leaving a permanent trail of
 * corrections that makes the real record harder to read, not easier to trust.
 *
 * Two concessions to honesty, since this is the one editable surface on the
 * platform: an edit stamps `edited_at` rather than passing silently, and a
 * delete is a tombstone rather than a DELETE, so a notice that was published
 * and withdrawn cannot be made to look like it never existed.
 */

const norm = (address) => String(address ?? "").toLowerCase();

/** Who a notice is meant for. Public ones also appear on the parent-facing page. */
export const AUDIENCE = { Students: "students", Public: "public" };

export function createAnnouncement({
  authorAddress,
  authorRole,
  collegeAddress,
  driveId = null,
  title,
  body,
  audience = AUDIENCE.Students,
}) {
  const info = db
    .prepare(
      `INSERT INTO announcements
         (author_address, author_role, college_address, drive_id, title, body, audience, created_at)
       VALUES (@authorAddress, @authorRole, @collegeAddress, @driveId, @title, @body, @audience, @now)`
    )
    .run({
      authorAddress: norm(authorAddress),
      authorRole,
      collegeAddress: norm(collegeAddress),
      driveId,
      title,
      body,
      audience,
      now: Date.now(),
    });
  return getAnnouncement(info.lastInsertRowid);
}

export function getAnnouncement(id) {
  return db.prepare("SELECT * FROM announcements WHERE id = ?").get(id);
}

/**
 * One notice with the author's name and the drive it refers to.
 *
 * Separate from getAnnouncement because the plain row is what ownership checks
 * want, while anything returned to a client needs the joined context — a notice
 * rendered without its author's name is just text from nobody.
 */
export function getAnnouncementWithContext(id) {
  return db
    .prepare(
      `SELECT a.*, actors.name AS author_name, d.role_title AS drive_role_title
         FROM announcements a
         LEFT JOIN actors ON actors.address = a.author_address
         LEFT JOIN drives d ON d.id = a.drive_id
        WHERE a.id = ?`
    )
    .get(id);
}

/**
 * Edits a notice.
 * @dev Scoped by author in the same statement, so an id belonging to someone
 *      else updates nothing. `edited_at` is always set: a notice quietly
 *      rewritten after people acted on it is the one failure mode an editable
 *      feed has, and stamping it costs nothing.
 */
export function updateAnnouncement(id, authorAddress, { title, body, audience }) {
  return (
    db
      .prepare(
        `UPDATE announcements
            SET title = @title, body = @body, audience = @audience, edited_at = @now
          WHERE id = @id AND author_address = @author AND deleted_at IS NULL`
      )
      .run({ id, author: norm(authorAddress), title, body, audience, now: Date.now() }).changes > 0
  );
}

/** Withdraws a notice. A tombstone, not a DELETE — see the file comment. */
export function deleteAnnouncement(id, authorAddress) {
  return (
    db
      .prepare(
        "UPDATE announcements SET deleted_at = ? WHERE id = ? AND author_address = ? AND deleted_at IS NULL"
      )
      .run(Date.now(), id, norm(authorAddress)).changes > 0
  );
}

/**
 * The notice feed for one college, newest first.
 * @param {Object} options
 * @param {string} [options.audience] Restrict to one audience — "public" for
 *   the parent-facing page, omitted for a signed-in student who sees both.
 * @param {string} [options.authorAddress] Only this author's notices.
 */
export function listAnnouncements(collegeAddress, { audience, authorAddress, limit = 50 } = {}) {
  const clauses = ["a.college_address = ?", "a.deleted_at IS NULL"];
  const params = [norm(collegeAddress)];
  if (audience) {
    clauses.push("a.audience = ?");
    params.push(audience);
  }
  if (authorAddress) {
    clauses.push("a.author_address = ?");
    params.push(norm(authorAddress));
  }

  return db
    .prepare(
      `SELECT a.*, actors.name AS author_name, d.role_title AS drive_role_title
         FROM announcements a
         LEFT JOIN actors ON actors.address = a.author_address
         LEFT JOIN drives d ON d.id = a.drive_id
        WHERE ${clauses.join(" AND ")}
        ORDER BY a.created_at DESC
        LIMIT ?`
    )
    .all(...params, limit);
}
