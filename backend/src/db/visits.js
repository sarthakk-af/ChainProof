import { db } from "./connection.js";

/** Mirrors PlacementTracker.VisitAnnounced events. */
export function upsertVisit(visit) {
  db.prepare(
    `INSERT INTO visits (id, college_address, company_name, ipfs_hash, visit_date, timestamp, block_number)
     VALUES (@id, @collegeAddress, @companyName, @ipfsHash, @visitDate, @timestamp, @blockNumber)
     ON CONFLICT(id) DO NOTHING`
  ).run(visit);
}

export function getVisitsForCollege(collegeAddress) {
  return db
    .prepare("SELECT * FROM visits WHERE college_address = ? ORDER BY id ASC")
    .all(collegeAddress);
}

/**
 * Most recent visit announcements across every college, newest first, joined
 * with the announcing college's name — powers the public dashboard's
 * "recent activity" feed.
 */
export function getRecentVisits(limit = 20) {
  return db
    .prepare(
      `SELECT v.*, a.name AS college_name
       FROM visits v
       LEFT JOIN actors a ON a.address = v.college_address
       ORDER BY v.id DESC
       LIMIT ?`
    )
    .all(limit);
}
