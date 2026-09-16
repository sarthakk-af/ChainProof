import { db } from "./connection.js";

/**
 * drives.js — the mirror of PlacementDrive, plus the off-chain applications.
 *
 * Everything here that came from the chain is written by the indexer and is a
 * cache: the contract is the source of truth, and this table exists only so the
 * app isn't reading the chain on every page load. Applications are the
 * exception — they are the platform's own record, deliberately kept off-chain,
 * with only their total attested by the company.
 */

export function upsertDrive(drive) {
  db.prepare(
    `INSERT INTO drives (
       id, company_address, college_address, role_title, annual_package,
       min_cgpa_scaled, batch_year, application_deadline, drive_date,
       ipfs_hash, status, posted_at, block_number
     ) VALUES (
       @id, @companyAddress, @collegeAddress, @roleTitle, @annualPackage,
       @minCgpaScaled, @batchYear, @applicationDeadline, @driveDate,
       @ipfsHash, @status, @postedAt, @blockNumber
     )
     ON CONFLICT(id) DO UPDATE SET
       status       = excluded.status,
       block_number = excluded.block_number`
  ).run({
    ...drive,
    companyAddress: drive.companyAddress.toLowerCase(),
    collegeAddress: drive.collegeAddress.toLowerCase(),
  });
}

/** Records a status change alone — every field but status is immutable on-chain. */
export function setDriveStatus(id, status, blockNumber) {
  db.prepare("UPDATE drives SET status = ?, block_number = ? WHERE id = ?").run(
    status,
    blockNumber,
    id
  );
}

/**
 * Records the company's attestation of how many applied.
 * @dev Distinct from counting rows in `applications`: that count is the
 *      platform's own, and the platform is run by the college whose conversion
 *      rate it shapes. This one is signed by the company.
 */
export function setDriveApplicationCount(id, count, blockNumber) {
  db.prepare("UPDATE drives SET application_count = ?, block_number = ? WHERE id = ?").run(
    count,
    blockNumber,
    id
  );
}

export function getDrive(id) {
  return db.prepare("SELECT * FROM drives WHERE id = ?").get(id);
}

export function listDrives({ collegeAddress, companyAddress, status, batchYear } = {}) {
  const clauses = [];
  const params = [];
  if (collegeAddress) {
    clauses.push("college_address = ?");
    params.push(collegeAddress.toLowerCase());
  }
  if (companyAddress) {
    clauses.push("company_address = ?");
    params.push(companyAddress.toLowerCase());
  }
  if (status !== undefined && status !== null) {
    clauses.push("status = ?");
    params.push(status);
  }
  if (batchYear !== undefined && batchYear !== null) {
    clauses.push("batch_year = ?");
    params.push(batchYear);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`SELECT * FROM drives ${where} ORDER BY drive_date DESC, id DESC`).all(...params);
}

// --- applications (off-chain) -----------------------------------------------

/**
 * Records that a student applied.
 * @returns {boolean} false if they had already applied — the PRIMARY KEY decides,
 *   so two simultaneous submissions can't both succeed.
 */
export function addApplication(driveId, studentAddress) {
  try {
    db.prepare(
      "INSERT INTO applications (drive_id, student_address, applied_at) VALUES (?, ?, ?)"
    ).run(driveId, studentAddress.toLowerCase(), Date.now());
    return true;
  } catch {
    return false;
  }
}

export function hasApplied(driveId, studentAddress) {
  return !!db
    .prepare("SELECT 1 FROM applications WHERE drive_id = ? AND LOWER(student_address) = LOWER(?)")
    .get(driveId, studentAddress);
}

export function countApplications(driveId) {
  return db.prepare("SELECT COUNT(*) AS c FROM applications WHERE drive_id = ?").get(driveId).c;
}

export function listApplicants(driveId) {
  return db
    .prepare(
      `SELECT a.student_address, a.applied_at,
              p.roll_number, p.full_name, p.course_code, p.batch_year, p.cgpa_scaled
         FROM applications a
         LEFT JOIN student_profiles p ON LOWER(p.address) = LOWER(a.student_address)
        WHERE a.drive_id = ?
        ORDER BY a.applied_at`
    )
    .all(driveId);
}

export function listApplicationsForStudent(studentAddress) {
  return db
    .prepare(
      `SELECT a.drive_id, a.applied_at, d.role_title, d.annual_package, d.drive_date,
              d.status, d.company_address
         FROM applications a
         JOIN drives d ON d.id = a.drive_id
        WHERE LOWER(a.student_address) = LOWER(?)
        ORDER BY a.applied_at DESC`
    )
    .all(studentAddress);
}
