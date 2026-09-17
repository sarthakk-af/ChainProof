import { db } from "./connection.js";
import { STUDENT_FIELDS } from "../studentProfile.js";

/**
 * profiles.js — everything identifying about a student.
 *
 * Never written to the chain: on-chain a student is a wallet address and nothing
 * more. This is where they are a person, and it stays in a database precisely so
 * it can be corrected, and erased, which a chain cannot offer.
 *
 * Columns are driven by STUDENT_FIELDS in src/studentProfile.js. Adding a field
 * there and to the schema is the whole change — nothing here names a field.
 */

const COLUMNS = STUDENT_FIELDS.map((f) => f.column);

export function upsertProfile(address, collegeAddress, values) {
  // college_address is updated on conflict along with everything else. Leaving
  // it out meant a profile that already existed kept whichever college it was
  // first written under — and since every query that matters (the talent pool,
  // the student directory, the college's own roster view) filters on this
  // column while authorisation reads the actor's college instead, a student
  // re-verified under a different college simply stopped appearing anywhere,
  // with no error and nothing in the logs.
  const assignments = ["college_address = @collegeAddress", ...COLUMNS.map((c) => `${c} = @${c}`)].join(", ");
  const params = { address: address.toLowerCase(), collegeAddress: collegeAddress.toLowerCase(), updatedAt: Date.now() };
  for (const column of COLUMNS) params[column] = values[column] ?? null;

  db.prepare(
    `INSERT INTO student_profiles (address, college_address, ${COLUMNS.join(", ")}, updated_at)
     VALUES (@address, @collegeAddress, ${COLUMNS.map((c) => "@" + c).join(", ")}, @updatedAt)
     ON CONFLICT(address) DO UPDATE SET ${assignments}, updated_at = @updatedAt`
  ).run(params);
}

/** Updates only the fields present in `values`, leaving the rest untouched. */
export function patchProfile(address, values) {
  const present = COLUMNS.filter((c) => Object.prototype.hasOwnProperty.call(values, c));
  if (present.length === 0) return;
  const assignments = present.map((c) => `${c} = @${c}`).join(", ");
  const params = { address: address.toLowerCase(), updatedAt: Date.now() };
  for (const column of present) params[column] = values[column] ?? null;
  db.prepare(
    `UPDATE student_profiles SET ${assignments}, updated_at = @updatedAt WHERE LOWER(address) = LOWER(@address)`
  ).run(params);
}

export function getProfile(address) {
  return db
    .prepare("SELECT * FROM student_profiles WHERE LOWER(address) = LOWER(?)")
    .get(address);
}

/**
 * Whether a student meets a drive's stated criteria.
 * @dev Returns the reason rather than a bare boolean: a student turned away is
 *      owed the specific cutoff they missed, not "you are not eligible". The
 *      criteria were published on-chain before applications opened, so this is
 *      checking against something the company committed to publicly.
 */
export function checkEligibility(profile, drive) {
  if (!profile) {
    return { eligible: false, reason: "Complete your profile before applying." };
  }
  if (drive.batch_year && profile.batch_year !== drive.batch_year) {
    return {
      eligible: false,
      reason: `This drive is open to the ${drive.batch_year} batch; your profile says ${profile.batch_year}.`,
    };
  }
  if (drive.min_cgpa_scaled > 0) {
    if (profile.cgpa_scaled === null || profile.cgpa_scaled === undefined) {
      return {
        eligible: false,
        reason: `This drive requires a CGPA of at least ${(drive.min_cgpa_scaled / 100).toFixed(2)}. Add your CGPA to your profile.`,
      };
    }
    if (profile.cgpa_scaled < drive.min_cgpa_scaled) {
      return {
        eligible: false,
        reason: `Requires a CGPA of at least ${(drive.min_cgpa_scaled / 100).toFixed(2)}; your profile says ${(profile.cgpa_scaled / 100).toFixed(2)}.`,
      };
    }
  }
  return { eligible: true, reason: null };
}
