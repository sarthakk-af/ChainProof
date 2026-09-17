import { db } from "./connection.js";

/**
 * publicStats.js — the aggregate reads behind the public dashboard.
 *
 * Every figure here is derived from mirrored chain events, never from anything
 * a user typed into this database. Individual students are absent by design:
 * the page exists to hold an institution accountable, not to publish what
 * happened to any particular person.
 */

/**
 * The funnel for one drive.
 * @dev `applied` is the company's own on-chain attestation, not a count of rows
 *      in the applications table. The row count belongs to the platform, and the
 *      platform is run by the college whose conversion rate the number shapes —
 *      so the figure published is the one signed by the party with nothing to
 *      gain from it. Null means the company has not stated it yet, which is not
 *      the same as zero.
 *
 * The stage counts are "ever reached", not "currently standing": a student who
 * was shortlisted and later rejected was still shortlisted, and a funnel that
 * forgot them would understate every stage above the last one.
 */
export function getDriveFunnelStats(driveId, { stageShortlisted, stageAssessment, stageInterview, stageOffered, acceptedResponse }) {
  const reached = (stage) =>
    db
      .prepare(
        "SELECT COUNT(DISTINCT student_address) AS c FROM drive_outcomes WHERE drive_id = ? AND stage = ?"
      )
      .get(driveId, stage).c;

  const drive = db.prepare("SELECT application_count FROM drives WHERE id = ?").get(driveId);

  return {
    applied: drive?.application_count ?? null,
    shortlisted: reached(stageShortlisted),
    assessed: reached(stageAssessment),
    interviewed: reached(stageInterview),
    offered: reached(stageOffered),
    accepted: db
      .prepare("SELECT COUNT(*) AS c FROM offer_responses WHERE drive_id = ? AND response = ?")
      .get(driveId, acceptedResponse).c,
  };
}

/**
 * Placement per cohort year for a college: placed against declared strength.
 * @dev Both halves come from the chain — placed from DriveOutcomes, declared from
 *      ActorRegistry — so neither can be adjusted without the adjustment itself
 *      being on the record. `revisions` surfaces how many times the college has
 *      restated the cohort size, because a denominator that keeps moving is worth
 *      seeing next to the percentage it produces.
 */
export function getPlacementByBatch(collegeAddress) {
  const college = collegeAddress.toLowerCase();
  return db
    .prepare(
      `SELECT b.batch_year,
              SUM(b.strength)                AS declared,
              MAX(b.revision_count)          AS revisions,
              COALESCE(p.placed, 0)          AS placed,
              COALESCE(r.listed, 0)          AS listed,
              COALESCE(r.claimed, 0)         AS registered
         FROM batches b
         LEFT JOIN (
           SELECT batch_year, COUNT(*) AS placed
             FROM placements
            WHERE college_address = ? AND placed = 1
            GROUP BY batch_year
         ) p ON p.batch_year = b.batch_year
         LEFT JOIN (
           SELECT batch_year,
                  COUNT(*) AS listed,
                  SUM(CASE WHEN claimed_by IS NOT NULL THEN 1 ELSE 0 END) AS claimed
             FROM roster_entries
            WHERE college_address = ?
            GROUP BY batch_year
         ) r ON r.batch_year = b.batch_year
        WHERE b.college_address = ?
        GROUP BY b.batch_year
        ORDER BY b.batch_year DESC`
    )
    .all(college, college, college);
}

/** Headline counts for the landing page. */
export function getOverviewCounts({ roleCollege, roleCompany, roleStudent, statusActive }) {
  const actors = (role, status) =>
    status === undefined
      ? db.prepare("SELECT COUNT(*) AS c FROM actors WHERE role = ?").get(role).c
      : db.prepare("SELECT COUNT(*) AS c FROM actors WHERE role = ? AND status = ?").get(role, status).c;

  return {
    colleges: actors(roleCollege, statusActive),
    companies: actors(roleCompany, statusActive),
    students: actors(roleStudent),
    drives: db.prepare("SELECT COUNT(*) AS c FROM drives").get().c,
    placed: db.prepare("SELECT COUNT(*) AS c FROM placements WHERE placed = 1").get().c,
  };
}

/**
 * Companies that have actually run a drive here, with what they offered.
 * @dev The package is the company's own published figure, so "what do companies
 *      pay at this college" is answerable without the college being the source.
 *
 *      Only drives the public may see are counted. This used to count every
 *      drive, so a company the college turned down — and the package it had
 *      proposed — appeared on the public page even though the drive list beside
 *      it correctly withheld the same drive.
 */
export function getRecruiterSummary(collegeAddress, visibleStatuses) {
  const placeholders = visibleStatuses.map(() => "?").join(", ");
  return db
    .prepare(
      `SELECT d.company_address,
              a.name AS company_name,
              COUNT(*)                AS drive_count,
              MAX(d.annual_package)   AS highest_package,
              MIN(d.annual_package)   AS lowest_package,
              MAX(d.drive_date)       AS latest_drive
         FROM drives d
         LEFT JOIN actors a ON a.address = d.company_address
        WHERE d.college_address = ? AND d.status IN (${placeholders})
        GROUP BY d.company_address, a.name
        ORDER BY latest_drive DESC`
    )
    .all(collegeAddress.toLowerCase(), ...visibleStatuses);
}
