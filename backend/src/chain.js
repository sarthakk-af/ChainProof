import { ethers } from "ethers";
import { config, deployment } from "./config.js";

export const provider = new ethers.JsonRpcProvider(config.rpcUrl);

export const verifierSigner = new ethers.Wallet(config.verifierPrivateKey, provider);

const { ActorRegistry, PlacementDrive, DriveOutcomes, PreparationLog } = deployment.contracts;

/** Read-only ActorRegistry instance, used by the indexer. */
export const actorRegistryRead = new ethers.Contract(
  ActorRegistry.address,
  ActorRegistry.abi,
  provider
);

/**
 * Verifier-signed ActorRegistry instance.
 * @dev Narrower than it was. The verifier now admits Colleges only — a Company is
 *      admitted by the Active College whose campus it recruits on, and that call is
 *      signed by the college's own wallet, not this one.
 */
export const actorRegistryAsVerifier = new ethers.Contract(
  ActorRegistry.address,
  ActorRegistry.abi,
  verifierSigner
);

/** Read-only PlacementDrive instance, used by the indexer and public reads. */
export const placementDriveRead = new ethers.Contract(
  PlacementDrive.address,
  PlacementDrive.abi,
  provider
);

/** Read-only DriveOutcomes instance, used by the indexer and placement-stat reads. */
export const driveOutcomesRead = new ethers.Contract(
  DriveOutcomes.address,
  DriveOutcomes.abi,
  provider
);

/** Read-only PreparationLog instance, used by the indexer and public reads. */
export const preparationLogRead = new ethers.Contract(
  PreparationLog.address,
  PreparationLog.abi,
  provider
);

/**
 * Signer-scoped contract instances for user-initiated actions. Each call site
 * passes in that request's decrypted user signer (see wallets.js) so the
 * resulting transaction's `msg.sender` is the acting user, not the platform.
 *
 * This matters more in v2 than it did before: the contracts decide what is
 * allowed purely from `msg.sender`. A company's outcome must be signed by the
 * company, a student's acceptance by the student. Signing on someone's behalf
 * here would quietly undo the guarantee the contracts exist to provide.
 */
export function actorRegistryAsSigner(signer) {
  return new ethers.Contract(ActorRegistry.address, ActorRegistry.abi, signer);
}

export function placementDriveAsSigner(signer) {
  return new ethers.Contract(PlacementDrive.address, PlacementDrive.abi, signer);
}

export function driveOutcomesAsSigner(signer) {
  return new ethers.Contract(DriveOutcomes.address, DriveOutcomes.abi, signer);
}

export function preparationLogAsSigner(signer) {
  return new ethers.Contract(PreparationLog.address, PreparationLog.abi, signer);
}

export const ROLE = { None: 0, Student: 1, College: 2, Company: 3 };
/**
 * @dev Suspended is an account whose access was withdrawn by the admin (or, for
 *      a company, by the college it recruits at). Everything it already signed
 *      stays exactly as it was — suspension stops an account acting, it never
 *      edits a record.
 */
export const STATUS = { None: 0, Pending: 1, Active: 2, Rejected: 3, Suspended: 4 };

/**
 * A drive's lifecycle. Mirrors PlacementDrive.DriveStatus.
 * Nothing is ever deleted — a called-off drive becomes Cancelled and stays visible.
 */
export const DRIVE_STATUS = {
  None: 0,
  Proposed: 1,
  Approved: 2,
  Rejected: 3,
  Closed: 4,
  Cancelled: 5,
};

/**
 * The canonical stages of a recruitment process. Mirrors DriveOutcomes.Stage.
 *
 * Fixed rather than company-defined so two companies' funnels stay comparable —
 * which is what makes a college-wide figure mean anything. Each record also
 * carries the company's own label ("Technical Round 2"), so a fixed set never
 * forces a company to misdescribe its process.
 *
 * Begins at Shortlisted because that is the first judgement a company makes.
 * Applying is the student's act; the per-drive application total is recorded
 * separately on PlacementDrive.
 */
export const STAGE = {
  None: 0,
  Shortlisted: 1,
  Assessment: 2,
  Interview: 3,
  Offered: 4,
  NotSelected: 5,
};

/** A student's answer to an offer. Mirrors DriveOutcomes.OfferResponse. */
export const OFFER_RESPONSE = { None: 0, Accepted: 1, Declined: 2 };
