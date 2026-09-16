import { db } from "./connection.js";
import { RESUME_KIND_KEYS, MAX_ITEMS_PER_KIND } from "../resume.js";

/**
 * resume.js — the repeatable half of a student profile, and their skills.
 *
 * Off-chain, like everything else that describes a person. On-chain a student
 * is a wallet address; this is where they are someone with a GitHub link and a
 * summer internship.
 *
 * Addresses are lower-cased on every read and write. The actors table learned
 * this the hard way: it stored checksummed addresses while other tables stored
 * lower-cased ones, so joins between them silently matched nothing and a
 * recruiter list came back empty with no error anywhere.
 */

const norm = (address) => String(address ?? "").toLowerCase();

// --- entries ----------------------------------------------------------------

/**
 * Adds one entry to a student's resume.
 * @returns {{item: Object}|{error: string}}
 */
export function addResumeItem(address, values) {
  const owner = norm(address);
  const count = db
    .prepare("SELECT COUNT(*) AS c FROM student_resume_items WHERE address = ? AND kind = ?")
    .get(owner, values.kind).c;
  if (count >= MAX_ITEMS_PER_KIND) {
    return { error: `You can list at most ${MAX_ITEMS_PER_KIND} entries in this section.` };
  }

  // New entries go to the end of their section. Students reorder by dragging,
  // which rewrites positions wholesale — see reorderResumeItems.
  const nextPosition = db
    .prepare(
      "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM student_resume_items WHERE address = ? AND kind = ?"
    )
    .get(owner, values.kind).p;

  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO student_resume_items
         (address, kind, title, subtitle, started_on, ended_on, description, url, position, created_at, updated_at)
       VALUES (@address, @kind, @title, @subtitle, @started_on, @ended_on, @description, @url, @position, @now, @now)`
    )
    .run({ ...values, address: owner, position: nextPosition, now });

  return { item: getResumeItem(info.lastInsertRowid) };
}

export function getResumeItem(id) {
  return db.prepare("SELECT * FROM student_resume_items WHERE id = ?").get(id);
}

/**
 * Replaces one entry's content.
 * @dev The id alone is not enough to authorise this — the owner is checked in
 *      the same statement, so an id guessed from someone else's profile updates
 *      nothing rather than updating their resume.
 */
export function updateResumeItem(id, address, values) {
  const info = db
    .prepare(
      `UPDATE student_resume_items
          SET title = @title, subtitle = @subtitle, started_on = @started_on,
              ended_on = @ended_on, description = @description, url = @url, updated_at = @now
        WHERE id = @id AND address = @address AND kind = @kind`
    )
    .run({ ...values, id, address: norm(address), now: Date.now() });
  return info.changes > 0;
}

/** Deletes one entry. Same ownership reasoning as updateResumeItem. */
export function deleteResumeItem(id, address) {
  return (
    db
      .prepare("DELETE FROM student_resume_items WHERE id = ? AND address = ?")
      .run(id, norm(address)).changes > 0
  );
}

/**
 * Rewrites the order of one section.
 * @dev Ids not belonging to this student are ignored rather than rejected: the
 *      statement is scoped by address, so a hostile list simply reorders
 *      nothing it does not own.
 */
export function reorderResumeItems(address, kind, orderedIds) {
  const owner = norm(address);
  const update = db.prepare(
    "UPDATE student_resume_items SET position = ? WHERE id = ? AND address = ? AND kind = ?"
  );
  const run = db.transaction(() => {
    orderedIds.forEach((id, index) => update.run(index, id, owner, kind));
  });
  run();
}

/** Every entry a student has, grouped by section, in display order. */
export function listResumeItems(address) {
  const rows = db
    .prepare(
      "SELECT * FROM student_resume_items WHERE address = ? ORDER BY kind, position, id"
    )
    .all(norm(address));

  const grouped = Object.fromEntries(RESUME_KIND_KEYS.map((k) => [k, []]));
  for (const row of rows) {
    if (grouped[row.kind]) grouped[row.kind].push(row);
  }
  return grouped;
}

/** How many entries each student in a set has. Used to show "profile 60% complete". */
export function countResumeItems(address) {
  return db
    .prepare("SELECT COUNT(*) AS c FROM student_resume_items WHERE address = ?")
    .get(norm(address)).c;
}

// --- skills -----------------------------------------------------------------

/**
 * Replaces a student's whole skill list.
 * @dev Replace rather than merge, because the form sends the complete list and
 *      a merge would make removing a skill impossible.
 */
export function setSkills(address, skills) {
  const owner = norm(address);
  const clear = db.prepare("DELETE FROM student_skills WHERE address = ?");
  const insert = db.prepare(
    "INSERT OR REPLACE INTO student_skills (address, skill, display) VALUES (?, ?, ?)"
  );
  const run = db.transaction(() => {
    clear.run(owner);
    for (const { skill, display } of skills) insert.run(owner, skill, display);
  });
  run();
}

/** A student's skills, as they typed them. */
export function listSkills(address) {
  return db
    .prepare("SELECT skill, display FROM student_skills WHERE address = ? ORDER BY display")
    .all(norm(address));
}

/** Skills for many students at once, so a list page is one query rather than N. */
export function skillsForAddresses(addresses) {
  if (addresses.length === 0) return new Map();
  const placeholders = addresses.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT address, display FROM student_skills
        WHERE address IN (${placeholders}) ORDER BY display`
    )
    .all(...addresses.map(norm));

  const byAddress = new Map();
  for (const row of rows) {
    if (!byAddress.has(row.address)) byAddress.set(row.address, []);
    byAddress.get(row.address).push(row.display);
  }
  return byAddress;
}

/**
 * The skills present in one college, most common first.
 *
 * This is what makes the company's filter usable: a recruiter should pick from
 * what the college's students actually know rather than guess a spelling and
 * get nothing back.
 */
export function skillVocabulary(collegeAddress, { batchYear, limit = 100 } = {}) {
  const clauses = ["p.college_address = ?"];
  const params = [norm(collegeAddress)];
  if (batchYear) {
    clauses.push("p.batch_year = ?");
    params.push(batchYear);
  }
  return db
    .prepare(
      `SELECT s.skill, MIN(s.display) AS display, COUNT(*) AS students
         FROM student_skills s
         JOIN student_profiles p ON p.address = s.address
        WHERE ${clauses.join(" AND ")}
        GROUP BY s.skill
        ORDER BY students DESC, display ASC
        LIMIT ?`
    )
    .all(...params, limit);
}
