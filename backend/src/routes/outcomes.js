import { Router } from "express";
import { ethers } from "ethers";
import {
  getActor,
  getDrive,
  hasApplied,
  getOutcomeHistory,
  getCurrentStages,
  getOfferResponse,
} from "../db.js";
import { getUserSigner } from "../wallets.js";
import {
  driveOutcomesAsSigner,
  driveOutcomesRead,
  ROLE,
  STATUS,
  DRIVE_STATUS,
  STAGE,
  OFFER_RESPONSE,
} from "../chain.js";
import {
  syncStageRecorded,
  syncOfferAnswered,
  syncPlacementChanged,
  findEventInReceipt,
  syncAfterWrite,
} from "../indexer.js";
import { withWalletLock } from "../txQueue.js";
import { serializeOutcome, OFFER_RESPONSE_NAMES } from "../serializers.js";
import { validateIpfsHash } from "../ipfsHash.js";
import { byteLength } from "../limits.js";
import {
  withIdempotency,
  fingerprintPayload,
  IdempotencyPendingError,
  IdempotencyKeyConflictError,
  IdempotencyUnresolvedError,
} from "../idempotency.js";
import { issueLimiter } from "../middleware/chainWriteLimiter.js";
import { logger } from "../logger.js";
import { publicChainError } from "../chainErrors.js";

/**
 * outcomes.js — what happened to each student, and what they said about it.
 *
 * Two writers, and only two:
 *   - the **company** running a drive records its stages;
 *   - the **student** answers their own offer.
 *
 * The college is absent on purpose. Everything a parent reads off the public
 * page is derived from these two, so a third party able to write here would
 * make the number a matter of opinion again.
 */
export const outcomesRouter = Router();

const MAX_LABEL_BYTES = 60;

/**
 * Records one stage for one student. Company-only.
 * @dev Stages are not forced to move forward. A real process ends at different
 *      points for different people, and an offer can be withdrawn weeks later —
 *      constraining the order would only push companies into recording
 *      something untrue.
 */
outcomesRouter.post("/:driveId/stage", issueLimiter, async (req, res) => {
  const caller = getActor(req.user.address);
  if (!caller || caller.role !== ROLE.Company || caller.status !== STATUS.Active) {
    return res.status(403).json({ error: "Only a college-approved company can record outcomes." });
  }

  const driveId = Number(req.params.driveId);
  const drive = getDrive(driveId);
  if (!drive) return res.status(404).json({ error: "No such drive." });
  if (drive.company_address.toLowerCase() !== req.user.address.toLowerCase()) {
    return res.status(403).json({ error: "That isn't your drive." });
  }
  if (drive.status !== DRIVE_STATUS.Approved && drive.status !== DRIVE_STATUS.Closed) {
    return res.status(409).json({ error: "That drive isn't accepting outcomes." });
  }

  const { studentAddress, stage, label, ipfsHash, idempotencyKey } = req.body || {};
  if (!ethers.isAddress(studentAddress)) {
    return res.status(400).json({ error: "A valid studentAddress is required." });
  }
  const stageNumber = STAGE[stage];
  if (stageNumber === undefined || stageNumber === STAGE.None) {
    return res.status(400).json({
      error: `Invalid stage. Expected one of: ${Object.keys(STAGE).filter((s) => s !== "None").join(", ")}`,
    });
  }

  const recipient = getActor(studentAddress);
  if (!recipient || recipient.role !== ROLE.Student) {
    return res.status(400).json({ error: "That address isn't a registered student." });
  }
  // A company may only judge people who actually entered its process.
  if (!hasApplied(driveId, studentAddress)) {
    return res.status(400).json({ error: "That student did not apply to this drive." });
  }

  const cleanLabel = String(label ?? "").trim();
  if (byteLength(cleanLabel) > MAX_LABEL_BYTES) {
    return res.status(400).json({ error: `Label must be ${MAX_LABEL_BYTES} bytes or fewer.` });
  }

  let cleanHash = "";
  if (ipfsHash) {
    const hashCheck = validateIpfsHash(ipfsHash);
    if (hashCheck.error) return res.status(400).json({ error: hashCheck.error });
    cleanHash = hashCheck.value;
  }

  try {
    const fingerprint = fingerprintPayload(["stage", driveId, studentAddress, stageNumber, cleanLabel, cleanHash]);
    const answer = await withIdempotency(req.user.id, idempotencyKey, fingerprint, ({ markBroadcast }) =>
      withWalletLock(req.user.address, async (nonce) => {
        const outcomes = driveOutcomesAsSigner(getUserSigner(req.user.id));
        const tx = await outcomes.recordStage(driveId, studentAddress, stageNumber, cleanLabel, cleanHash, { nonce });
        markBroadcast();
        const receipt = await tx.wait();

        const staged = findEventInReceipt(driveOutcomesRead, "StageRecorded", receipt);
        if (staged) {
          await syncAfterWrite("recorded stage", receipt.blockNumber, () =>
            syncStageRecorded(staged, receipt)
          );
        }
        // Withdrawing an offer a student had accepted un-places them in the same
        // transaction, so mirror that here rather than waiting for the listener.
        const placement = findEventInReceipt(driveOutcomesRead, "PlacementChanged", receipt);
        if (placement) {
          await syncAfterWrite("placement change", receipt.blockNumber, () =>
            syncPlacementChanged(placement, receipt)
          );
        }
        return { txHash: receipt.hash };
      })
    );

    logger.info("stage_recorded", { driveId, student: studentAddress, stage, company: req.user.address });
    res.status(201).json(answer);
  } catch (err) {
    if (
      err instanceof IdempotencyPendingError ||
      err instanceof IdempotencyKeyConflictError ||
      err instanceof IdempotencyUnresolvedError
    ) {
      return res.status(409).json({ error: err.message });
    }
    const reason = publicChainError(err);
    logger.error("stage_record_failed", { driveId, student: studentAddress, reason });
    res.status(400).json({ error: `On-chain update failed: ${reason}` });
  }
});

/**
 * Answers an offer. Student-only, and this is what makes a placement count.
 * @dev Signed by the student's own wallet. A company recording "accepted" on
 *      somebody's behalf would let it claim a placement the student never
 *      agreed to, which is exactly the number this platform exists to make
 *      unforgeable — so the contract only accepts msg.sender, and this route
 *      never signs for anyone else.
 */
outcomesRouter.post("/:driveId/answer", issueLimiter, async (req, res) => {
  const caller = getActor(req.user.address);
  // The contract refuses a suspended student too, but only after the gas is
  // spent and with a revert the reader can't interpret.
  if (!caller || caller.role !== ROLE.Student || caller.status !== STATUS.Active) {
    return res.status(403).json({ error: "Only the student can answer their own offer." });
  }

  const driveId = Number(req.params.driveId);
  const drive = getDrive(driveId);
  if (!drive) return res.status(404).json({ error: "No such drive." });

  const { response } = req.body || {};
  const responseNumber = OFFER_RESPONSE[response];
  if (responseNumber === undefined || responseNumber === OFFER_RESPONSE.None) {
    return res.status(400).json({ error: 'Answer must be "Accepted" or "Declined".' });
  }

  const stages = getCurrentStages(driveId);
  const mine = stages.find((s) => s.student_address.toLowerCase() === req.user.address.toLowerCase());
  if (!mine || mine.stage !== STAGE.Offered) {
    return res.status(409).json({ error: "You don't have a standing offer on this drive." });
  }
  if (getOfferResponse(driveId, req.user.address)) {
    return res.status(409).json({ error: "You have already answered this offer." });
  }

  try {
    const receipt = await withWalletLock(req.user.address, async (nonce) => {
      const outcomes = driveOutcomesAsSigner(getUserSigner(req.user.id));
      const tx = await outcomes.answerOffer(driveId, responseNumber, { nonce });
      return tx.wait();
    });

    const answered = findEventInReceipt(driveOutcomesRead, "OfferAnswered", receipt);
    if (answered) {
      await syncAfterWrite("offer answer", receipt.blockNumber, () =>
        syncOfferAnswered(answered, receipt)
      );
    }
    const placement = findEventInReceipt(driveOutcomesRead, "PlacementChanged", receipt);
    if (placement) {
      await syncAfterWrite("placement change", receipt.blockNumber, () =>
        syncPlacementChanged(placement, receipt)
      );
    }

    logger.info("offer_answered", { driveId, student: req.user.address, response });
    res.status(201).json({ txHash: receipt.hash, response });
  } catch (err) {
    const reason = publicChainError(err);
    logger.error("offer_answer_failed", { driveId, student: req.user.address, reason });
    res.status(400).json({ error: `On-chain update failed: ${reason}` });
  }
});

/**
 * The full path a student took through one drive.
 * @dev Visible to the student themselves, the company running the drive, and
 *      the college hosting it — and nobody else. A fellow student has no
 *      business reading someone's rejections.
 */
outcomesRouter.get("/:driveId/history/:address", (req, res) => {
  const { driveId, address } = req.params;
  if (!ethers.isAddress(address)) {
    return res.status(400).json({ error: "Invalid student address" });
  }
  const drive = getDrive(Number(driveId));
  if (!drive) return res.status(404).json({ error: "No such drive." });

  const me = req.user.address.toLowerCase();
  const allowed =
    me === address.toLowerCase() ||
    me === drive.company_address.toLowerCase() ||
    me === drive.college_address.toLowerCase();
  if (!allowed) {
    return res.status(403).json({ error: "Not allowed to view this record." });
  }

  const response = getOfferResponse(Number(driveId), address);
  res.json({
    history: getOutcomeHistory(Number(driveId), address).map(serializeOutcome),
    offerResponse: response ? OFFER_RESPONSE_NAMES[response.response] : null,
  });
});
