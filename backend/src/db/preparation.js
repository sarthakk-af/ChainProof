import { db } from "./connection.js";

/**
 * preparation.js — the mirror of PreparationLog.
 *
 * Every row here came from a chain event and nothing else writes to it. That is
 * the point of the table: the college's claim about what it did to prepare
 * students is only worth reading because it could not be edited afterwards, and
 * a mirror that accepted direct writes would quietly undo that.
 */

const norm = (address) => String(address ?? "").toLowerCase();

/** The on-chain EventKind enum, mirrored for readable queries and responses. */
export const EVENT_KIND = {
  None: 0,
  Training: 1,
  MockInterview: 2,
  Workshop: 3,
  Seminar: 4,
  Other: 5,
};

export const EVENT_KIND_LABELS = {
  1: "Training",
  2: "Mock interview",
  3: "Workshop",
  4: "Seminar",
  5: "Other",
};

/**
 * Records one event from a chain log.
 * @dev ON CONFLICT DO NOTHING because the indexer re-reads overlapping block
 *      ranges after a gap or a restart, so the same log legitimately arrives
 *      more than once. Ignoring the repeat is correct; the id comes from the
 *      contract, so a second arrival is the same event, never a new one.
 */
export function upsertPreparationEvent(event) {
  db.prepare(
    `INSERT INTO preparation_events
       (id, college_address, kind, title, conducted_by, held_on, attendance,
        batch_year, ipfs_hash, cancelled, cancel_reason, recorded_at, block_number)
     VALUES (@id, @collegeAddress, @kind, @title, @conductedBy, @heldOn, @attendance,
             @batchYear, @ipfsHash, 0, NULL, @recordedAt, @blockNumber)
     ON CONFLICT(id) DO NOTHING`
  ).run({ ...event, collegeAddress: norm(event.collegeAddress) });
}

/** Marks an event cancelled, from the chain's PreparationCancelled log. */
export function setPreparationCancelled(id, reason, blockNumber) {
  db.prepare(
    `UPDATE preparation_events
        SET cancelled = 1, cancel_reason = ?, block_number = ?
      WHERE id = ?`
  ).run(reason ?? null, blockNumber, id);
}

export function getPreparationEvent(id) {
  return db.prepare("SELECT * FROM preparation_events WHERE id = ?").get(id);
}

/**
 * A college's preparation record, most recent first.
 * @param {Object} options
 * @param {number} [options.batchYear] Events aimed at one cohort. Events open to
 *   everyone (batch_year 0) are included, because excluding them would make a
 *   cohort's record look emptier than it was.
 * @param {boolean} [options.includeCancelled] Cancelled events are shown by
 *   default: hiding them would let a college record ten sessions, call off nine
 *   and still look busy, which is exactly what the on-chain cancellation exists
 *   to prevent.
 */
export function listPreparationEvents(
  collegeAddress,
  { batchYear, includeCancelled = true, limit = 200 } = {}
) {
  const clauses = ["college_address = ?"];
  const params = [norm(collegeAddress)];
  if (batchYear) {
    clauses.push("(batch_year = ? OR batch_year = 0)");
    params.push(batchYear);
  }
  if (!includeCancelled) clauses.push("cancelled = 0");

  return db
    .prepare(
      `SELECT * FROM preparation_events
        WHERE ${clauses.join(" AND ")}
        ORDER BY held_on DESC, id DESC
        LIMIT ?`
    )
    .all(...params, limit);
}

/**
 * Counts by kind for the public page, plus the totals either side of it.
 * @dev `standing` is what a college may claim; `cancelled` is published beside
 *      it rather than subtracted silently, so the difference is visible.
 */
export function preparationSummary(collegeAddress, { batchYear } = {}) {
  const clauses = ["college_address = ?"];
  const params = [norm(collegeAddress)];
  if (batchYear) {
    clauses.push("(batch_year = ? OR batch_year = 0)");
    params.push(batchYear);
  }

  const rows = db
    .prepare(
      `SELECT kind,
              COUNT(*) AS total,
              SUM(CASE WHEN cancelled = 0 THEN 1 ELSE 0 END) AS standing,
              SUM(CASE WHEN cancelled = 0 THEN attendance ELSE 0 END) AS attendance
         FROM preparation_events
        WHERE ${clauses.join(" AND ")}
        GROUP BY kind
        ORDER BY kind`
    )
    .all(...params);

  const byKind = rows.map((r) => ({
    kind: EVENT_KIND_LABELS[r.kind] ?? "Other",
    standing: r.standing,
    cancelled: r.total - r.standing,
    attendance: r.attendance,
  }));

  return {
    byKind,
    standing: byKind.reduce((sum, r) => sum + r.standing, 0),
    cancelled: byKind.reduce((sum, r) => sum + r.cancelled, 0),
    // Attendance is summed across sessions, so one student attending three
    // sessions counts three times. Named `attendances` rather than `students`
    // so nobody reads it as a headcount.
    attendances: byKind.reduce((sum, r) => sum + r.attendance, 0),
  };
}
