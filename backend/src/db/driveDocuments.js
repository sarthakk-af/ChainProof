import { db } from "./connection.js";

/**
 * driveDocuments.js — the job descriptions behind drives, by content hash.
 *
 * Written before the drive's transaction is sent, so the document exists by
 * the time anything on-chain points at it. Keyed by the hash, so saving the
 * same document twice is a no-op rather than a conflict.
 */

export function saveDriveDocument(cid, content) {
  db.prepare(
    "INSERT INTO drive_documents (cid, content, created_at) VALUES (?, ?, ?) ON CONFLICT(cid) DO NOTHING"
  ).run(cid, content, Date.now());
}

/** The stored document for a hash, parsed, or null if this platform never held it. */
export function getDriveDocument(cid) {
  if (!cid) return null;
  const row = db.prepare("SELECT content FROM drive_documents WHERE cid = ?").get(cid);
  if (!row) return null;
  try {
    return JSON.parse(row.content);
  } catch {
    return null;
  }
}

/**
 * The description to show for a drive row.
 * @dev Null when the drive has none, and also when its hash points at a
 *      document this platform never held — a drive posted directly on-chain,
 *      or before descriptions were stored here.
 */
export function driveDescription(driveRow) {
  return getDriveDocument(driveRow?.ipfs_hash)?.description ?? null;
}
