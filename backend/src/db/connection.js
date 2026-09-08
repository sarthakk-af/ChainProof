import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { config } from "../config.js";

const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS actors (
    address TEXT PRIMARY KEY,
    role INTEGER NOT NULL,
    status INTEGER NOT NULL,
    name TEXT NOT NULL,
    metadata TEXT,
    college TEXT,
    registered_at_block INTEGER NOT NULL,
    updated_at_block INTEGER NOT NULL,
    rejection_reason TEXT
  );

  CREATE TABLE IF NOT EXISTS indexer_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_synced_block INTEGER NOT NULL DEFAULT 0
  );

  INSERT OR IGNORE INTO indexer_state (id, last_synced_block) VALUES (1, 0);

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    wallet_address TEXT UNIQUE NOT NULL,
    encrypted_private_key TEXT NOT NULL,
    token_version INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);

  CREATE TABLE IF NOT EXISTS credentials (
    id INTEGER PRIMARY KEY,
    student_address TEXT NOT NULL,
    issuer_address TEXT NOT NULL,
    ipfs_hash TEXT NOT NULL,
    cred_type INTEGER NOT NULL,
    timestamp INTEGER NOT NULL,
    block_number INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_credentials_student ON credentials(student_address);

  CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY,
    college_address TEXT NOT NULL,
    company_name TEXT NOT NULL,
    ipfs_hash TEXT NOT NULL,
    visit_date INTEGER NOT NULL,
    timestamp INTEGER NOT NULL,
    block_number INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_visits_college ON visits(college_address);
`);

// Lightweight migration for a database file created before token_version
// existed — CREATE TABLE IF NOT EXISTS above only applies to brand-new files.
const userColumns = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
if (!userColumns.includes("token_version")) {
  db.exec("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0");
}

// Same pattern for a database file created before rejection_reason existed.
const actorColumns = db.prepare("PRAGMA table_info(actors)").all().map((c) => c.name);
if (!actorColumns.includes("rejection_reason")) {
  db.exec("ALTER TABLE actors ADD COLUMN rejection_reason TEXT");
}
if (!actorColumns.includes("metadata")) {
  db.exec("ALTER TABLE actors ADD COLUMN metadata TEXT");
}

export function getLastSyncedBlock() {
  return db.prepare("SELECT last_synced_block FROM indexer_state WHERE id = 1").get()
    .last_synced_block;
}

export function setLastSyncedBlock(blockNumber) {
  db.prepare("UPDATE indexer_state SET last_synced_block = ? WHERE id = 1").run(blockNumber);
}
