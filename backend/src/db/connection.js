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
    rejection_reason TEXT,
    rejection_count INTEGER NOT NULL DEFAULT 0,
    website_reachable INTEGER,
    join_code TEXT,
    registration_number TEXT
  );

  -- Every dashboard load and public-stats query filters actors by role/status
  -- and/or groups by college (see routes/students.js, routes/colleges.js,
  -- routes/public.js) — this table had no index beyond its address primary key.
  CREATE INDEX IF NOT EXISTS idx_actors_role_status ON actors(role, status);
  CREATE INDEX IF NOT EXISTS idx_actors_college ON actors(college);

  CREATE TABLE IF NOT EXISTS indexer_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_synced_block INTEGER NOT NULL DEFAULT 0,
    deployment_fingerprint TEXT
  );

  INSERT OR IGNORE INTO indexer_state (id, last_synced_block) VALUES (1, 0);

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    wallet_address TEXT UNIQUE NOT NULL,
    encrypted_private_key TEXT NOT NULL,
    token_version INTEGER NOT NULL DEFAULT 0,
    email_verified INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  -- A signup isn't usable (can't log in, see routes/auth.js's /login) until
  -- the OTP emailed here is entered back — see routes/auth.js's /verify-email.
  -- Only one row per user at a time: a fresh OTP replaces whatever came before.
  CREATE TABLE IF NOT EXISTS email_otps (
    user_id INTEGER PRIMARY KEY,
    otp_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
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
    block_number INTEGER NOT NULL,
    is_correction INTEGER NOT NULL DEFAULT 0,
    supersedes_id INTEGER,
    superseded INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_credentials_student ON credentials(student_address);

  -- Claims the real-world identifier (CIN / accreditation ID) an institution
  -- registers under, so two different accounts can't both claim to be the
  -- same legal entity. Separate from actors.registration_number rather than a
  -- UNIQUE column on it, because the actor row doesn't exist until *after*
  -- the on-chain write — the claim has to be taken before that write so a
  -- duplicate is rejected without anything permanent having happened. See
  -- routes/me.js's /register.
  --
  -- Deliberately NOT applied to the display name: plenty of genuinely
  -- different institutions share one ("Government Polytechnic" many times
  -- over), so a shared name is flagged for the admin to look at, not blocked.
  CREATE TABLE IF NOT EXISTS registration_number_claims (
    registration_number TEXT PRIMARY KEY,
    address TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reg_claims_address ON registration_number_claims(address);

  -- Named admin accounts — replaces relying solely on one shared secret for
  -- every approval decision (see routes/admin.js's /auth/login and
  -- /admins). The shared ADMIN_API_KEY still exists, but only to bootstrap
  -- these accounts — actual approve/reject actions require a real admin
  -- session tied to one of these rows, so a decision can be attributed to
  -- an actual person, not just "someone with the key."
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- Every verification decision (approve/reject) is logged here, permanently,
  -- in the same spirit as the on-chain records — the goal is "someone can
  -- always answer who decided what and when," not just "the app enforced
  -- some rule." admin_username records exactly which admin account made the
  -- call (nullable only for decisions logged before named admins existed).
  CREATE TABLE IF NOT EXISTS admin_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_address TEXT NOT NULL,
    actor_name TEXT,
    action TEXT NOT NULL,
    reason TEXT,
    tx_hash TEXT,
    admin_username TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_admin_actions_created ON admin_actions(created_at);

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
if (!userColumns.includes("email_verified")) {
  db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0");
}

// Same pattern for a database file created before rejection_reason existed.
const actorColumns = db.prepare("PRAGMA table_info(actors)").all().map((c) => c.name);
if (!actorColumns.includes("rejection_reason")) {
  db.exec("ALTER TABLE actors ADD COLUMN rejection_reason TEXT");
}
if (!actorColumns.includes("metadata")) {
  db.exec("ALTER TABLE actors ADD COLUMN metadata TEXT");
}
if (!actorColumns.includes("rejection_count")) {
  db.exec("ALTER TABLE actors ADD COLUMN rejection_count INTEGER NOT NULL DEFAULT 0");
}
if (!actorColumns.includes("website_reachable")) {
  db.exec("ALTER TABLE actors ADD COLUMN website_reachable INTEGER");
}
if (!actorColumns.includes("join_code")) {
  db.exec("ALTER TABLE actors ADD COLUMN join_code TEXT");
}
if (!actorColumns.includes("registration_number")) {
  db.exec("ALTER TABLE actors ADD COLUMN registration_number TEXT");
}

const adminActionColumns = db.prepare("PRAGMA table_info(admin_actions)").all().map((c) => c.name);
if (!adminActionColumns.includes("admin_username")) {
  db.exec("ALTER TABLE admin_actions ADD COLUMN admin_username TEXT");
}

const indexerStateColumns = db.prepare("PRAGMA table_info(indexer_state)").all().map((c) => c.name);
if (!indexerStateColumns.includes("deployment_fingerprint")) {
  db.exec("ALTER TABLE indexer_state ADD COLUMN deployment_fingerprint TEXT");
}

// Emails are stored lowercased (see db/users.js's normalizeEmail). Rows
// created before that rule existed may carry mixed case, which would make them
// unreachable once every lookup normalises. Lowercase them in place.
//
// A row is skipped rather than rewritten where doing so would collide with an
// existing account — two real accounts differing only by case are a genuine
// data problem, and silently deleting one of them (each owns a funded
// custodial wallet) would be far worse than leaving it visible. It's logged
// loudly instead so a human decides.
const mixedCaseEmails = db
  .prepare("SELECT id, email FROM users WHERE email <> lower(email)")
  .all();
if (mixedCaseEmails.length > 0) {
  const findConflict = db.prepare(
    "SELECT id FROM users WHERE email = ? AND id <> ?"
  );
  const rename = db.prepare("UPDATE users SET email = ? WHERE id = ?");
  const collisions = [];
  const migrate = db.transaction(() => {
    for (const row of mixedCaseEmails) {
      const lowered = row.email.trim().toLowerCase();
      if (findConflict.get(lowered, row.id)) {
        collisions.push(row.email);
        continue;
      }
      rename.run(lowered, row.id);
    }
  });
  migrate();
  if (collisions.length > 0) {
    console.warn(
      `[db] ${collisions.length} account(s) could not be lowercased because another ` +
        `account already uses that address. These need to be merged by hand: ` +
        collisions.join(", ")
    );
  }
}

const credentialColumns = db.prepare("PRAGMA table_info(credentials)").all().map((c) => c.name);
if (!credentialColumns.includes("is_correction")) {
  db.exec("ALTER TABLE credentials ADD COLUMN is_correction INTEGER NOT NULL DEFAULT 0");
}
if (!credentialColumns.includes("supersedes_id")) {
  db.exec("ALTER TABLE credentials ADD COLUMN supersedes_id INTEGER");
}
if (!credentialColumns.includes("superseded")) {
  db.exec("ALTER TABLE credentials ADD COLUMN superseded INTEGER NOT NULL DEFAULT 0");
}

export function getLastSyncedBlock() {
  return db.prepare("SELECT last_synced_block FROM indexer_state WHERE id = 1").get()
    .last_synced_block;
}

export function setLastSyncedBlock(blockNumber) {
  db.prepare("UPDATE indexer_state SET last_synced_block = ? WHERE id = 1").run(blockNumber);
}

export function getDeploymentFingerprint() {
  return db.prepare("SELECT deployment_fingerprint FROM indexer_state WHERE id = 1").get()
    .deployment_fingerprint;
}

/**
 * Wipes every table this indexer mirrors and resets the sync cursor to 0,
 * then records the new fingerprint — used when the configured contracts turn
 * out to be a fresh deployment the current DB has never seen (see
 * indexer.js's resetIfRedeployed). A local Hardhat restart redeploys to the
 * *same* addresses (deterministic CREATE from a reset nonce) but wipes all
 * on-chain history and restarts every id counter at 0 — so old mirrored rows
 * would otherwise collide with genuinely new ones sharing the same id and
 * get silently dropped by `ON CONFLICT DO NOTHING`, quietly losing real data.
 */
export function resetMirrorForNewDeployment(fingerprint) {
  db.exec("DELETE FROM actors; DELETE FROM credentials; DELETE FROM visits;");
  db.prepare(
    "UPDATE indexer_state SET last_synced_block = 0, deployment_fingerprint = ? WHERE id = 1"
  ).run(fingerprint);
}
