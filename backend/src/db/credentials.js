import { db } from "./connection.js";

/** Mirrors CredentialIssuer.CredentialIssued events. */
export function upsertCredential(credential) {
  db.prepare(
    `INSERT INTO credentials (id, student_address, issuer_address, ipfs_hash, cred_type, timestamp, block_number)
     VALUES (@id, @studentAddress, @issuerAddress, @ipfsHash, @credType, @timestamp, @blockNumber)
     ON CONFLICT(id) DO NOTHING`
  ).run(credential);
}

export function getCredentialsForStudent(studentAddress) {
  return db
    .prepare("SELECT * FROM credentials WHERE student_address = ? ORDER BY id ASC")
    .all(studentAddress);
}

/**
 * One row per student that has at least one credential: their highest credential
 * type reached (for pipeline-stage display) and whether an Offer (cred_type = 3)
 * is among them. Computed in a single query so listing many students doesn't
 * need one credentials lookup per student.
 */
export function getCredentialSummaries() {
  const rows = db
    .prepare(
      `SELECT student_address,
              MAX(cred_type) AS max_cred_type,
              MAX(CASE WHEN cred_type = 3 THEN 1 ELSE 0 END) AS is_placed
       FROM credentials
       GROUP BY student_address`
    )
    .all();
  return new Map(rows.map((r) => [r.student_address, r]));
}
