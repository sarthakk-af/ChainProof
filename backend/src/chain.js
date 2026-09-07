import { ethers } from "ethers";
import { config, deployment } from "./config.js";

export const provider = new ethers.JsonRpcProvider(config.rpcUrl);

export const verifierSigner = new ethers.Wallet(config.verifierPrivateKey, provider);

const { ActorRegistry, CredentialIssuer, PlacementTracker } = deployment.contracts;

/** Read-only ActorRegistry instance, used by the indexer. */
export const actorRegistryRead = new ethers.Contract(
  ActorRegistry.address,
  ActorRegistry.abi,
  provider
);

/** Verifier-signed ActorRegistry instance, used by the admin approve/reject routes. */
export const actorRegistryAsVerifier = new ethers.Contract(
  ActorRegistry.address,
  ActorRegistry.abi,
  verifierSigner
);

/** Read-only CredentialIssuer instance, used by the indexer and placement-stat reads. */
export const credentialIssuerRead = new ethers.Contract(
  CredentialIssuer.address,
  CredentialIssuer.abi,
  provider
);

/** Read-only PlacementTracker instance, used by the indexer. */
export const placementTrackerRead = new ethers.Contract(
  PlacementTracker.address,
  PlacementTracker.abi,
  provider
);

/**
 * Signer-scoped contract instances for user-initiated actions. Each call site
 * passes in that request's decrypted user signer (see wallets.js) so the
 * resulting transaction's `msg.sender` is the acting user, not the platform.
 */
export function actorRegistryAsSigner(signer) {
  return new ethers.Contract(ActorRegistry.address, ActorRegistry.abi, signer);
}

export function credentialIssuerAsSigner(signer) {
  return new ethers.Contract(CredentialIssuer.address, CredentialIssuer.abi, signer);
}

export function placementTrackerAsSigner(signer) {
  return new ethers.Contract(PlacementTracker.address, PlacementTracker.abi, signer);
}

export const ROLE = { None: 0, Student: 1, College: 2, Company: 3 };
export const STATUS = { None: 0, Pending: 1, Active: 2, Rejected: 3 };
export const CRED_TYPE = { General: 0, Shortlist: 1, Interview: 2, Offer: 3, Rejection: 4 };
