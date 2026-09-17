import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { config } from "../config.js";
import { columnDefinitions } from "../studentProfile.js";

const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

// In WAL mode new writes land in chainproof.sqlite-wal and are only folded into
// the main file once the log reaches about 4 MB — which this app rarely does.
// Until then the main file can be almost empty, and a viewer that reads only
// that file (the VS Code "SQLite Viewer" extension, for one) shows no tables at
// all. Folding the log in on start and every 30 seconds keeps the main file
// current. PASSIVE never blocks a reader or writer; it does what it can.
function checkpoint() {
  try {
    db.pragma("wal_checkpoint(PASSIVE)");
  } catch {
    // A busy database simply gets checkpointed on the next tick.
  }
}
checkpoint();
const checkpointTimer = setInterval(checkpoint, 30_000);
if (typeof checkpointTimer.unref === "function") checkpointTimer.unref();

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
    registration_number TEXT
  );

  -- Every dashboard load and public-stats query filters actors by role/status
  -- and/or groups by college — this table had no index beyond its address
  -- primary key.
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
    is_college_login INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  -- The code emailed at signup. Confirming it is one of the two conditions for
  -- a student to be verified (see studentVerification.js); it no longer blocks
  -- signing in. Only one row per user at a time: a fresh OTP replaces whatever
  -- came before.
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

  -- The platform owner's login, created on first start from ADMIN_USERNAME and
  -- ADMIN_PASSWORD (see server.js). A row rather than a shared secret, so every
  -- admin action can be attributed to an account.
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- Every account decision — a company admitted or declined by the college, an
  -- account suspended or reinstated by the owner — logged permanently, in the
  -- same spirit as the on-chain records: someone can always answer who decided
  -- what and when. The owner's own actions are shown back to them in the admin
  -- panel rather than kept in a log nobody reads.
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


  -- ===========================================================================
  -- v2: rosters, profiles, drives, applications, outcomes
  -- ===========================================================================

  -- The college's own list of who is actually its student, uploaded per batch.
  -- A signup claims an unclaimed row; nothing else admits a student. This is
  -- what "is this person really from here?" resolves to, and it is deliberately
  -- the college's data rather than a self-declared field.
  CREATE TABLE IF NOT EXISTS roster_entries (
    college_address TEXT NOT NULL,
    roll_number TEXT NOT NULL,
    full_name TEXT NOT NULL,
    course_code TEXT NOT NULL,
    batch_year INTEGER NOT NULL,
    claimed_by TEXT,
    claimed_at INTEGER,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (college_address, roll_number)
  );
  CREATE INDEX IF NOT EXISTS idx_roster_claimed ON roster_entries(claimed_by);
  CREATE INDEX IF NOT EXISTS idx_roster_batch ON roster_entries(college_address, batch_year);

  -- Everything identifying about a student. Never written to the chain: on-chain
  -- a student is only a wallet address. Columns are derived from
  -- src/studentProfile.js, which is the single place the field list is declared.
  CREATE TABLE IF NOT EXISTS student_profiles (
    address TEXT PRIMARY KEY,
    college_address TEXT NOT NULL,
    ${columnDefinitions().join(",\n    ")},
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_profiles_college ON student_profiles(college_address, batch_year);

  -- Mirror of ActorRegistry's declared cohort sizes — the denominator of every
  -- placement percentage. previous_strength is kept so the UI can show that a
  -- figure was revised without re-reading the whole event log.
  CREATE TABLE IF NOT EXISTS batches (
    college_address TEXT NOT NULL,
    course_code TEXT NOT NULL,
    batch_year INTEGER NOT NULL,
    strength INTEGER NOT NULL,
    previous_strength INTEGER,
    revision_count INTEGER NOT NULL DEFAULT 0,
    block_number INTEGER NOT NULL,
    PRIMARY KEY (college_address, course_code, batch_year)
  );

  -- Mirror of PlacementDrive. application_count is the company's own attestation
  -- of how many applied; NULL means it has not been stated yet, which is not the
  -- same as zero.
  CREATE TABLE IF NOT EXISTS drives (
    id INTEGER PRIMARY KEY,
    company_address TEXT NOT NULL,
    college_address TEXT NOT NULL,
    role_title TEXT NOT NULL,
    annual_package INTEGER NOT NULL,
    min_cgpa_scaled INTEGER NOT NULL DEFAULT 0,
    batch_year INTEGER NOT NULL,
    application_deadline INTEGER NOT NULL,
    drive_date INTEGER NOT NULL,
    ipfs_hash TEXT NOT NULL,
    status INTEGER NOT NULL,
    application_count INTEGER,
    posted_at INTEGER NOT NULL,
    block_number INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_drives_college ON drives(college_address, status);
  CREATE INDEX IF NOT EXISTS idx_drives_company ON drives(company_address);

  -- Off-chain by design: personal data, hundreds per drive, and no single one is
  -- disputed. Only the total is attested on-chain, by the company.
  CREATE TABLE IF NOT EXISTS applications (
    drive_id INTEGER NOT NULL,
    student_address TEXT NOT NULL,
    applied_at INTEGER NOT NULL,
    PRIMARY KEY (drive_id, student_address)
  );
  CREATE INDEX IF NOT EXISTS idx_applications_student ON applications(student_address);

  -- Mirror of DriveOutcomes' append-only stage history. One row per recorded
  -- stage, never updated — a withdrawn offer is a new row, not an edit.
  CREATE TABLE IF NOT EXISTS drive_outcomes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drive_id INTEGER NOT NULL,
    student_address TEXT NOT NULL,
    stage INTEGER NOT NULL,
    previous_stage INTEGER NOT NULL,
    label TEXT,
    ipfs_hash TEXT,
    timestamp INTEGER NOT NULL,
    block_number INTEGER NOT NULL,
    UNIQUE (drive_id, student_address, block_number, stage)
  );
  CREATE INDEX IF NOT EXISTS idx_outcomes_drive ON drive_outcomes(drive_id);
  CREATE INDEX IF NOT EXISTS idx_outcomes_student ON drive_outcomes(student_address);

  -- The student's answer to an offer. Only a student can write this on-chain;
  -- this is the mirror of that fact.
  CREATE TABLE IF NOT EXISTS offer_responses (
    drive_id INTEGER NOT NULL,
    student_address TEXT NOT NULL,
    response INTEGER NOT NULL,
    timestamp INTEGER NOT NULL,
    block_number INTEGER NOT NULL,
    PRIMARY KEY (drive_id, student_address)
  );

  -- Mirror of who currently counts as placed. Derived entirely from chain
  -- events: a student is placed only while holding an accepted offer that the
  -- company has not withdrawn, so this falls as well as rises.
  CREATE TABLE IF NOT EXISTS placements (
    student_address TEXT PRIMARY KEY,
    college_address TEXT NOT NULL,
    batch_year INTEGER NOT NULL,
    placed INTEGER NOT NULL,
    block_number INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_placements_batch ON placements(college_address, batch_year, placed);

  -- A student's request to be recognised as a real student of this college.
  --
  -- Exists because the two orderings have to both work: a student who signs up
  -- after the roster is uploaded should be verified instantly, and one who signs
  -- up before it should wait in a queue rather than hit a wall. Previously only
  -- the first ordering worked, and the second was a dead end.
  --
  -- status: 0 pending, 1 verified, 2 rejected.
  CREATE TABLE IF NOT EXISTS student_verifications (
    user_id INTEGER PRIMARY KEY,
    address TEXT NOT NULL,
    college_address TEXT NOT NULL,
    roll_number TEXT NOT NULL,
    status INTEGER NOT NULL DEFAULT 0,
    reason TEXT,
    created_at INTEGER NOT NULL,
    decided_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_verifications_college
    ON student_verifications(college_address, status);
  CREATE INDEX IF NOT EXISTS idx_verifications_address
    ON student_verifications(address);


  -- ===========================================================================
  -- v3: resumes, skills, announcements, preparation events
  -- ===========================================================================

  -- The repeatable half of a resume: projects, internships, prior education,
  -- certifications, achievements. One table rather than five, because they are
  -- the same shape — a title, who it was with, when, and what it was — and five
  -- near-identical tables would mean five near-identical queries drifting apart.
  --
  -- Entirely self-claimed and entirely off-chain. Nothing here is verified by
  -- anyone, and that is deliberate: a resume changes constantly, and a false
  -- claim surfaces at the interview. What this platform guarantees is not that
  -- a resume is true, it is that the placement record is.
  CREATE TABLE IF NOT EXISTS student_resume_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    subtitle TEXT,
    started_on TEXT,
    ended_on TEXT,
    description TEXT,
    url TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_resume_items_address
    ON student_resume_items(address, kind, position);

  -- Skills live in their own table rather than a comma-separated column because
  -- a company filters on them: "who here knows React" has to be an indexed
  -- lookup, not a LIKE over every profile. skill is the normalised form used
  -- for matching; display is what the student actually typed.
  CREATE TABLE IF NOT EXISTS student_skills (
    address TEXT NOT NULL,
    skill TEXT NOT NULL,
    display TEXT NOT NULL,
    PRIMARY KEY (address, skill)
  );
  CREATE INDEX IF NOT EXISTS idx_skills_skill ON student_skills(skill);

  -- Placement notices: "the interview moved to Hall B, bring two copies".
  --
  -- Off-chain and editable on purpose. An announcement is not the record — the
  -- drive or event it refers to is already on-chain and permanent. Putting
  -- operational notices there too would mean paying gas to immortalise a room
  -- number, and a record full of stale corrections is harder to read, not more
  -- trustworthy.
  --
  -- Edits are visible rather than silent: edited_at is set on every change so
  -- a notice that was rewritten after the fact says so.
  CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author_address TEXT NOT NULL,
    author_role INTEGER NOT NULL,
    college_address TEXT NOT NULL,
    drive_id INTEGER,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    audience TEXT NOT NULL DEFAULT 'students',
    created_at INTEGER NOT NULL,
    edited_at INTEGER,
    deleted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_announcements_college
    ON announcements(college_address, deleted_at, created_at);
  CREATE INDEX IF NOT EXISTS idx_announcements_author
    ON announcements(author_address);

  -- Mirror of PreparationLog: what the college did to prepare students.
  --
  -- The one record where the college is the author rather than the subject.
  -- recorded_at is the block timestamp, not the claimed date — it is what
  -- separates a log kept as the year went from one assembled in June.
  CREATE TABLE IF NOT EXISTS preparation_events (
    id INTEGER PRIMARY KEY,
    college_address TEXT NOT NULL,
    kind INTEGER NOT NULL,
    title TEXT NOT NULL,
    conducted_by TEXT NOT NULL,
    held_on INTEGER NOT NULL,
    attendance INTEGER NOT NULL DEFAULT 0,
    batch_year INTEGER NOT NULL DEFAULT 0,
    ipfs_hash TEXT,
    cancelled INTEGER NOT NULL DEFAULT 0,
    cancel_reason TEXT,
    recorded_at INTEGER NOT NULL,
    block_number INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_preparation_college
    ON preparation_events(college_address, held_on);
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
// Marks the one login the administrator created for the placement cell. A local
// chain reset erases the college's on-chain identity but not this row, and the
// flag is what lets the administrator put that same login back on-chain rather
// than being told its email is already taken — without being able to do the
// same to any other account.
if (!userColumns.includes("is_college_login")) {
  db.exec("ALTER TABLE users ADD COLUMN is_college_login INTEGER NOT NULL DEFAULT 0");
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
// join_code belonged to v1, where a student joined a college by typing a code
// the college handed out. Verification is by roll number now and nothing reads
// or writes the column, so it is dropped from databases that still carry it.
if (actorColumns.includes("join_code")) {
  db.exec("ALTER TABLE actors DROP COLUMN join_code");
}
if (!actorColumns.includes("registration_number")) {
  db.exec("ALTER TABLE actors ADD COLUMN registration_number TEXT");
}

// The profile field list is expected to keep growing (see src/studentProfile.js),
// and `CREATE TABLE IF NOT EXISTS` above does nothing for a database file that
// already exists. Rather than hand-writing an ALTER for each new field — the
// thing that guarantees someone eventually forgets one — every declared column
// that is missing is added here.
const profileColumns = db.prepare("PRAGMA table_info(student_profiles)").all().map((c) => c.name);
for (const definition of columnDefinitions()) {
  const [columnName] = definition.split(" ");
  if (!profileColumns.includes(columnName)) {
    db.exec(`ALTER TABLE student_profiles ADD COLUMN ${definition}`);
  }
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
  db.exec(
    "DELETE FROM actors; DELETE FROM batches; DELETE FROM drives; " +
      "DELETE FROM drive_outcomes; DELETE FROM offer_responses; DELETE FROM placements; " +
      "DELETE FROM preparation_events;"
  );
  // Applications are the platform's own record rather than a mirror of the
  // chain, but they point at drive ids that a redeploy renumbers from zero —
  // so leaving them would attach real students to unrelated drives.
  db.exec("DELETE FROM applications;");
  // A student's verification and their claim on a roster row are both
  // statements about a college that existed on the old chain. After a redeploy
  // that college is gone and a new one has a different address, so those rows
  // point at nothing: the student reads as verified while every route that
  // matters refuses them, and their roll number stays claimed by an identity
  // that no longer exists. Clearing them puts everyone back to "sign in and
  // claim your roll number", which is a state the product knows how to handle.
  // The roster itself is the college's own data and is deliberately kept.
  db.exec("DELETE FROM student_verifications;");
  db.exec("UPDATE roster_entries SET claimed_by = NULL, claimed_at = NULL WHERE claimed_by IS NOT NULL;");
  // Notices go too. Every one of them is about a season on the old chain — a
  // drive that no longer exists, a college identity that has been erased — and
  // keeping them meant each reset-and-seed left another copy of the same notice
  // under the college's reused login, which read like invented data.
  db.exec("DELETE FROM announcements;");
  db.prepare(
    "UPDATE indexer_state SET last_synced_block = 0, deployment_fingerprint = ? WHERE id = 1"
  ).run(fingerprint);
}
