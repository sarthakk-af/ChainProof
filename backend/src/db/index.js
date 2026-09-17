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
  getActor,
  listActors,
  clearRejectionReason,
  setWebsiteReachable,
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
  VERIFICATION,
  upsertVerification,
  getVerification,
  setVerificationStatus,
  listPendingVerifications,
  rollNumberPending,
} from "./verifications.js";
export {
  upsertRosterEntries,
  getRosterEntry,
  claimRosterEntry,
  releaseRosterClaim,
  getRosterEntryForAddress,
  listRoster,
  rosterCounts,
} from "./roster.js";
export {
  upsertProfile,
  patchProfile,
  getProfile,
  checkEligibility,
} from "./profiles.js";
export {
  upsertBatch,
  listBatches,
} from "./batches.js";
export {
  upsertDrive,
  setDriveStatus,
  setDriveApplicationCount,
  getDrive,
  listDrives,
  addApplication,
  hasApplied,
  countApplications,
  listApplicants,
  listApplicationsForStudent,
} from "./drives.js";
export {
  addOutcome,
  getOutcomeHistory,
  getCurrentStages,
  setOfferResponse,
  getOfferResponse,
  setPlacement,
  isPlaced,
} from "./outcomes.js";
export {
  getDriveFunnelStats,
  getPlacementByBatch,
  getOverviewCounts,
  getRecruiterSummary,
} from "./publicStats.js";
export {
  addResumeItem,
  getResumeItem,
  updateResumeItem,
  deleteResumeItem,
  reorderResumeItems,
  listResumeItems,
  setSkills,
  listSkills,
  skillsForAddresses,
  skillVocabulary,
} from "./resume.js";
export {
  AUDIENCE,
  createAnnouncement,
  getAnnouncement,
  getAnnouncementWithContext,
  updateAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
} from "./announcements.js";
export {
  EVENT_KIND,
  EVENT_KIND_LABELS,
  upsertPreparationEvent,
  setPreparationCancelled,
  getPreparationEvent,
  listPreparationEvents,
  preparationSummary,
} from "./preparation.js";
export {
  searchTalentPool,
  getTalentProfile,
  talentFacets,
  lookupStudent,
  hasAppliedToCompany,
  getContactDetails,
} from "./directory.js";
export { logAdminAction, listAdminActions } from "./adminActions.js";
export {
  getRegistrationNumberClaim,
  claimRegistrationNumber,
  releaseClaimsForAddress,
} from "./registrationClaims.js";
