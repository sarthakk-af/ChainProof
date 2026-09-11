/**
 * db/index.js — Aggregates the per-domain DB modules into one import surface.
 * See ../db.js for why this exists as a folder instead of one file.
 */
export {
  db,
  getLastSyncedBlock,
  setLastSyncedBlock,
  getDeploymentFingerprint,
  resetMirrorForNewDeployment,
} from "./connection.js";
export {
  upsertActor,
  updateActorStatus,
  getActor,
  listActors,
  clearRejectionReason,
  setWebsiteReachable,
  setJoinCode,
  setRegistrationNumber,
} from "./actors.js";
export {
  createUser,
  getUserByEmail,
  getUserById,
  setPasswordHash,
  setEmailVerified,
  bumpTokenVersion,
  createPasswordReset,
  getPasswordReset,
  invalidateAllPasswordResetsForUser,
} from "./users.js";
export { setEmailOtp, getEmailOtp, incrementOtpAttempts, deleteEmailOtp } from "./emailOtps.js";
export {
  upsertCredential,
  markCredentialSuperseded,
  getCredentialsForStudent,
  getCredentialSummaries,
} from "./credentials.js";
export { upsertVisit, getVisitsForCollege, getRecentVisits } from "./visits.js";
export { getPerCollegePlacementStats, countPlacedStudentsGlobal, getCollegeRecords } from "./publicStats.js";
export { logAdminAction, listAdminActions } from "./adminActions.js";
export { createAdmin, getAdminByUsername, getAdminById, listAdmins } from "./admins.js";
export {
  getRegistrationNumberClaim,
  claimRegistrationNumber,
  releaseClaimsForAddress,
  findDuplicateNames,
} from "./registrationClaims.js";
