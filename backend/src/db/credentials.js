import { db } from "./connection.js";

/** Mirrors CredentialIssuer.CredentialIssued events (fresh issuances and corrections alike). */
export function upsertCredential(credential) {
  const row = { isCorrection: 0, supersedesId: null, ...credential };
  db.prepare(
    `INSERT INTO credentials (id, student_address, issuer_address, ipfs_hash, cred_type, timestamp, block_number, is_correction, supersedes_id)
     VALUES (@id, @studentAddress, @issuerAddress, @ipfsHash, @credType, @timestamp, @blockNumber, @isCorrection, @supersedesId)
     ON CONFLICT(id) DO NOTHING`
  ).run(row);
}

/** Called when a correction targets an earlier credential — that original is never edited, only flagged. */
export function markCredentialSuperseded(id) {
  db.prepare("UPDATE credentials SET superseded = 1 WHERE id = ?").run(id);
}

export function getCredentialsForStudent(studentAddress) {
  return db
    .prepare("SELECT * FROM credentials WHERE student_address = ? ORDER BY id ASC")
    .all(studentAddress);
}

/**
 * One row per student that has at least one credential: their highest credential
 * type currently standing (for pipeline-stage display) and whether a
 * non-superseded Offer (cred_type = 3) is among them. Both exclude superseded
 * rows — a corrected credential no longer reflects the student's current
 * state, so it can't be allowed to outrank whatever replaced it (e.g. a
 * corrected-away Rejection has a higher raw enum value than Offer and would
 * otherwise incorrectly win a naive MAX(cred_type) here). Computed in a
 * single query so listing many students doesn't need one lookup per student.
 */
export function getCredentialSummaries() {
  const rows = db
    .prepare(
      `SELECT student_address,
              MAX(CASE WHEN superseded = 0 THEN cred_type END) AS max_cred_type,
              MAX(CASE WHEN cred_type = 3 AND superseded = 0 THEN 1 ELSE 0 END) AS is_placed
       FROM credentials
       GROUP BY student_address`
    )
    .all();
  return new Map(rows.map((r) => [r.student_address, r]));
}
