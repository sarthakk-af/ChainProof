import { ethers } from "ethers";
import { config, deployment } from "./config.js";

/**
 * The chain id comes from the deployment manifest rather than being detected.
 *
 * Detection is a loop: when the node isn't reachable, ethers retries every
 * second, forever. That kept the process alive with nothing to do — the backend
 * test suite, which never needs a chain, hung for minutes whenever the local
 * node wasn't running. Telling the provider which network to expect removes
 * the loop; a request to a node that is down now simply fails.
 */
const network = ethers.Network.from(Number(deployment.chainId ?? 31337));
export const provider = new ethers.JsonRpcProvider(config.rpcUrl, network, {
  staticNetwork: network,
});

/**
 * Caps the tip every transaction offers, on the one provider every signer here
 * shares.
 *
 * On Polygon Amoy the node's suggested tip runs at 500+ gwei — set by a few
 * senders overpaying — while blocks include transactions tipping 25 gwei, the
 * network minimum. Taking the suggestion made a student's registration cost
 * ~0.075 POL: more than the 0.05 each new wallet is given, so every action
 * failed for want of funds. The fee ceiling is recomputed from the capped tip
 * too, because a node checks a wallet can cover the ceiling before accepting a
 * transaction, whatever it finally charges.
 *
 * @param {bigint|null} capWei The most to tip, or null for no cap.
 */
export function capPriorityFee(target, capWei) {
  if (capWei === null) return target;
  const suggested = target.getFeeData.bind(target);
  target.getFeeData = async () => {
    const fee = await suggested();
    if (fee.maxPriorityFeePerGas === null) {
      // A chain without EIP-1559 fees: cap the plain gas price instead.
      const gasPrice = fee.gasPrice !== null && fee.gasPrice > capWei ? capWei : fee.gasPrice;
      return new ethers.FeeData(gasPrice, null, null);
    }
    const tip = fee.maxPriorityFeePerGas > capWei ? capWei : fee.maxPriorityFeePerGas;
    const block = await target.getBlock("latest");
    const baseFee = block?.baseFeePerGas ?? 0n;
    return new ethers.FeeData(fee.gasPrice, baseFee * 2n + tip, tip);
  };
  return target;
}

capPriorityFee(
  provider,
  config.maxPriorityFeeGwei === null ? null : ethers.parseUnits(String(config.maxPriorityFeeGwei), "gwei")
);

/**
 * Waits until a mined transaction is final — the network has committed to the
 * block it is in, and it can no longer be replaced.
 *
 * On a public chain the newest blocks are provisional for a few seconds: now
 * and then the network settles on a different block than the one first seen,
 * and a transaction in the discarded block moves or disappears. A record
 * mirrored before then could show something the chain no longer has — a
 * student placed by an acceptance that never landed. Polygon reports finality
 * itself (the "finalized" block, 2–5 seconds behind the newest on Amoy), so
 * this waits for that rather than guessing a number of blocks.
 *
 * Returns the receipt as it stands in the final chain, which is the one to
 * read events from: if the transaction was moved to a later block, the first
 * receipt describes a block that no longer exists.
 */
export async function waitUntilFinal(target, receipt, { timeoutMs = 90_000, pollMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const finalized = await target.getBlock("finalized");
    if (finalized && finalized.number >= receipt.blockNumber) {
      const current = await target.getTransactionReceipt(receipt.hash);
      if (!current) {
        throw new Error(
          "The network dropped this transaction before it became final, so nothing was recorded. Please try again."
        );
      }
      if (current.blockNumber <= finalized.number) return current;
    }
    if (Date.now() > deadline) {
      throw new Error(
        "This was sent to the blockchain, but the network hasn't confirmed it as final yet. " +
          "Reload in a minute to check whether it went through before trying again."
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/**
 * Waits for a sent transaction to be mined and — on a public network — final.
 * Every write the platform records goes through this. Locally there is nothing
 * to wait for: one machine, no competing blocks, so it is just `tx.wait()`.
 */
export async function settle(tx) {
  const receipt = await tx.wait();
  if (!config.waitForFinality) return receipt;
  return waitUntilFinal(provider, receipt);
}

/** The newest block the mirror may read up to: the final one, or simply the newest. */
export async function readableHead() {
  if (!config.waitForFinality) return provider.getBlockNumber();
  const finalized = await provider.getBlock("finalized");
  return finalized ? finalized.number : provider.getBlockNumber();
}

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
