import { db } from "./connection.js";

/**
 * directory.js — finding students.
 *
 * Two different questions, deliberately answered by two different queries:
 *
 *   1. A **company** browsing the talent pool. It filters on course, batch,
 *      CGPA, skills and whether someone is already placed — and gets back no
 *      name, email or phone. Enough to judge a candidate, not enough to contact
 *      one. A company that wants to reach a student posts a drive; that is the
 *      whole reason the college sits in the middle.
 *
 *   2. A **student** looking up a classmate, which requires knowing both their
 *      roll number and their email. Not much of a secret, so the rate limit on
 *      the route matters as much as this does — but it does mean a profile is
 *      something you look up, not something you can enumerate.
 *
 * Neither query is allowed to leak what the other withholds, so identifying
 * columns are simply not selected in the first one rather than filtered out
 * afterwards. A field that is never read cannot be forgotten in a serializer.
 */

const norm = (address) => String(address ?? "").toLowerCase();

/**
 * Searches the pool a company may see.
 *
 * @param {string} collegeAddress The college whose students these are.
 * @param {Object} filters
 * @param {number} [filters.batchYear]
 * @param {string} [filters.courseCode]
 * @param {number} [filters.minCgpaScaled] Inclusive floor, scaled by 100.
 * @param {string[]} [filters.skills] Normalised skill keys; a student must have
 *   ALL of them. "React AND SQL" is what a recruiter means by listing two.
 * @param {boolean} [filters.placed] true = only placed, false = only unplaced.
 * @param {number} [filters.limit]
 * @param {number} [filters.offset]
 * @returns {{rows: Object[], total: number}}
 */
export function searchTalentPool(collegeAddress, filters = {}) {
  const { batchYear, courseCode, minCgpaScaled, skills = [], placed, limit = 25, offset = 0 } = filters;

  const clauses = ["p.college_address = @college"];
  const params = { college: norm(collegeAddress), limit, offset };

  if (batchYear) {
    clauses.push("p.batch_year = @batchYear");
    params.batchYear = batchYear;
  }
  if (courseCode) {
    clauses.push("p.course_code = @courseCode");
    params.courseCode = courseCode;
  }
  if (minCgpaScaled) {
    // A student with no CGPA on their profile is excluded from a CGPA filter
    // rather than treated as zero — "not stated" is not "below the bar", but it
    // is also not something a recruiter asking for 7.5 wants to wade through.
    clauses.push("p.cgpa_scaled IS NOT NULL AND p.cgpa_scaled >= @minCgpa");
    params.minCgpa = minCgpaScaled;
  }
  if (placed === true) {
    clauses.push("EXISTS (SELECT 1 FROM placements pl WHERE pl.student_address = p.address AND pl.placed = 1)");
  } else if (placed === false) {
    clauses.push("NOT EXISTS (SELECT 1 FROM placements pl WHERE pl.student_address = p.address AND pl.placed = 1)");
  }

  // Each required skill becomes its own EXISTS rather than an IN + HAVING
  // COUNT, because IN would match a student holding any one of them and the
  // recruiter asked for all.
  skills.forEach((skill, index) => {
    const key = `skill${index}`;
    clauses.push(`EXISTS (SELECT 1 FROM student_skills s WHERE s.address = p.address AND s.skill = @${key})`);
    params[key] = skill;
  });

  const where = clauses.join(" AND ");

  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM student_profiles p WHERE ${where}`)
    .get(params).c;

  // Note what is absent: full_name, phone, and anything joining to users.email.
  const rows = db
    .prepare(
      `SELECT p.address, p.roll_number, p.course_code, p.batch_year, p.cgpa_scaled,
              p.headline, p.about, p.hobbies, p.github_url, p.linkedin_url, p.portfolio_url,
              EXISTS (SELECT 1 FROM placements pl
                       WHERE pl.student_address = p.address AND pl.placed = 1) AS is_placed
         FROM student_profiles p
        WHERE ${where}
        ORDER BY p.cgpa_scaled IS NULL, p.cgpa_scaled DESC, p.roll_number
        LIMIT @limit OFFSET @offset`
    )
    .all(params);

  return { rows, total };
}

/** One student's anonymised card, by roll number, within one college. */
export function getTalentProfile(collegeAddress, rollNumber) {
  return db
    .prepare(
      `SELECT p.address, p.roll_number, p.course_code, p.batch_year, p.cgpa_scaled,
              p.headline, p.about, p.hobbies, p.github_url, p.linkedin_url, p.portfolio_url,
              EXISTS (SELECT 1 FROM placements pl
                       WHERE pl.student_address = p.address AND pl.placed = 1) AS is_placed
         FROM student_profiles p
        WHERE p.college_address = ? AND p.roll_number = ?`
    )
    .get(norm(collegeAddress), rollNumber);
}

/**
 * The filter options a company can actually choose from.
 *
 * Built from the students who are really there rather than a hard-coded list,
 * so a recruiter picking "MECH-B, 2027" gets results instead of an empty page
 * and no explanation.
 */
export function talentFacets(collegeAddress) {
  const college = norm(collegeAddress);
  const courses = db
    .prepare(
      `SELECT course_code AS code, COUNT(*) AS students
         FROM student_profiles
        WHERE college_address = ? AND course_code IS NOT NULL
        GROUP BY course_code ORDER BY course_code`
    )
    .all(college);
  const batches = db
    .prepare(
      `SELECT batch_year AS year, COUNT(*) AS students
         FROM student_profiles
        WHERE college_address = ? AND batch_year IS NOT NULL
        GROUP BY batch_year ORDER BY batch_year DESC`
    )
    .all(college);
  return { courses, batches };
}

/**
 * Looks up one student by roll number *and* email.
 *
 * Both, always. Either alone would make the directory enumerable — roll numbers
 * run in sequence, and college emails are usually derivable from them — and the
 * point of requiring the pair is that finding a classmate means already knowing
 * who you are looking for.
 */
export function lookupStudent(collegeAddress, rollNumber, email) {
  return db
    .prepare(
      `SELECT p.*, u.email
         FROM student_profiles p
         JOIN users u ON LOWER(u.wallet_address) = p.address
        WHERE p.college_address = ? AND p.roll_number = ? AND u.email = ?`
    )
    .get(norm(collegeAddress), rollNumber, String(email ?? "").trim().toLowerCase());
}

/**
 * Whether a student applied to any drive this company posted.
 *
 * This is what unlocks contact details, and it is the student's own doing:
 * applying is how they say "you may contact me". Browsing never reveals it.
 */
export function hasAppliedToCompany(studentAddress, companyAddress) {
  const row = db
    .prepare(
      `SELECT 1 AS found
         FROM applications a
         JOIN drives d ON d.id = a.drive_id
        WHERE a.student_address = ? AND d.company_address = ?
        LIMIT 1`
    )
    .get(norm(studentAddress), norm(companyAddress));
  return !!row;
}

/** Name, email and phone for a student who has applied to this company. */
export function getContactDetails(studentAddress) {
  return db
    .prepare(
      `SELECT p.full_name, p.phone, u.email
         FROM student_profiles p
         JOIN users u ON LOWER(u.wallet_address) = p.address
        WHERE p.address = ?`
    )
    .get(norm(studentAddress));
}
