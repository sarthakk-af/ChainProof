const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * DriveOutcomes — where the placement percentage actually comes from.
 *
 * Three properties these tests exist to protect, in order of how much damage
 * their absence would do:
 *   1. only the company running a drive records its outcomes;
 *   2. only the student answers an offer — nobody is counted as placed
 *      without having said yes themselves;
 *   3. a withdrawn offer un-places the student, because a number that only
 *      ever goes up is not a measurement.
 */
describe("DriveOutcomes", function () {
  let actorRegistry, placementDrive, driveOutcomes;
  let verifier, college1, college2, company1, company2, student1, student2, stranger;

  const Role = { None: 0, Student: 1, College: 2, Company: 3 };
  const Stage = {
    None: 0,
    Shortlisted: 1,
    Assessment: 2,
    Interview: 3,
    Offered: 4,
    NotSelected: 5,
  };
  const Answer = { None: 0, Accepted: 1, Declined: 2 };
  const ZERO_ADDRESS = ethers.ZeroAddress;
  const CID = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
  const BATCH = 2026;

  let DEADLINE, DRIVE_DATE;

  beforeEach(async function () {
    [, verifier, college1, college2, company1, company2, student1, student2, stranger] =
      await ethers.getSigners();

    const ActorRegistry = await ethers.getContractFactory("ActorRegistry");
    actorRegistry = await ActorRegistry.deploy(verifier.address);

    const PlacementDrive = await ethers.getContractFactory("PlacementDrive");
    placementDrive = await PlacementDrive.deploy(await actorRegistry.getAddress());

    const DriveOutcomes = await ethers.getContractFactory("DriveOutcomes");
    driveOutcomes = await DriveOutcomes.deploy(
      await actorRegistry.getAddress(),
      await placementDrive.getAddress()
    );

    const now = (await ethers.provider.getBlock("latest")).timestamp;
    DEADLINE = now + 7 * 24 * 60 * 60;
    DRIVE_DATE = now + 14 * 24 * 60 * 60;

    await activeCollege(college1, "IIT Bombay");
    await activeCollege(college2, "Other Institute");
    await activeCompany(company1, "Infosys", college1);
    await activeCompany(company2, "Rival Ltd", college1);
    await actorRegistry.connect(student1).register(Role.Student, "Student One", "", college1.address);
    await actorRegistry.connect(student2).register(Role.Student, "Student Two", "", college1.address);

    await actorRegistry.connect(college1).recordBatchStrength("CSE", BATCH, 180);
  });

  async function activeCollege(signer, name) {
    await actorRegistry.connect(signer).register(Role.College, name, "", ZERO_ADDRESS);
    await actorRegistry.connect(verifier).approveActor(signer.address);
  }
  async function activeCompany(signer, name, approvingCollege) {
    await actorRegistry.connect(signer).register(Role.Company, name, "", ZERO_ADDRESS);
    await actorRegistry.connect(approvingCollege).approveActor(signer.address);
  }

  /** Posts and approves a drive, returning its id. */
  async function openDrive(company = company1, college = college1, batchYear = BATCH) {
    const id = Number(await placementDrive.nextDriveId());
    await placementDrive
      .connect(company)
      .postDrive(college.address, "Software Engineer", 650000, 700, batchYear, DEADLINE, DRIVE_DATE, CID);
    await placementDrive.connect(college).approveDrive(id);
    return id;
  }

  /** Walks a student to an accepted offer on `driveId`. */
  async function acceptOffer(driveId, company, student) {
    await driveOutcomes.connect(company).recordStage(driveId, student.address, Stage.Offered, "Final", "");
    await driveOutcomes.connect(student).answerOffer(driveId, Answer.Accepted);
  }

  // ===========================================================================
  describe("Deployment", function () {
    it("should store both contract references", async function () {
      expect(await driveOutcomes.actorRegistry()).to.equal(await actorRegistry.getAddress());
      expect(await driveOutcomes.placementDrive()).to.equal(await placementDrive.getAddress());
    });

    it("should revert deployment with a zero address", async function () {
      const DriveOutcomes = await ethers.getContractFactory("DriveOutcomes");
      await expect(
        DriveOutcomes.deploy(ZERO_ADDRESS, await placementDrive.getAddress())
      ).to.be.revertedWithCustomError(driveOutcomes, "InvalidAddress");
      await expect(
        DriveOutcomes.deploy(await actorRegistry.getAddress(), ZERO_ADDRESS)
      ).to.be.revertedWithCustomError(driveOutcomes, "InvalidAddress");
    });
  });

  // ===========================================================================
  describe("Recording stages — only the drive's own company", function () {
    let driveId;
    beforeEach(async function () {
      driveId = await openDrive();
    });

    it("should let the drive's company record a stage", async function () {
      await expect(
        driveOutcomes
          .connect(company1)
          .recordStage(driveId, student1.address, Stage.Shortlisted, "Round 1", CID)
      )
        .to.emit(driveOutcomes, "StageRecorded")
        .withArgs(
          driveId,
          student1.address,
          company1.address,
          Stage.None,
          Stage.Shortlisted,
          "Round 1",
          CID,
          (t) => t > 0
        );

      expect(await driveOutcomes.currentStage(driveId, student1.address)).to.equal(Stage.Shortlisted);
    });

    it("should NOT let the college record a stage", async function () {
      // The single most important refusal in the contract: a college marking its
      // own students selected is the self-reported statistic this replaces.
      await expect(
        driveOutcomes.connect(college1).recordStage(driveId, student1.address, Stage.Offered, "", "")
      )
        .to.be.revertedWithCustomError(driveOutcomes, "NotDriveCompany")
        .withArgs(college1.address, driveId);
    });

    it("should NOT let a different company record on this drive", async function () {
      await expect(
        driveOutcomes.connect(company2).recordStage(driveId, student1.address, Stage.Offered, "", "")
      )
        .to.be.revertedWithCustomError(driveOutcomes, "NotDriveCompany")
        .withArgs(company2.address, driveId);
    });

    it("should NOT let the student record their own stage", async function () {
      await expect(
        driveOutcomes.connect(student1).recordStage(driveId, student1.address, Stage.Offered, "", "")
      ).to.be.revertedWithCustomError(driveOutcomes, "NotDriveCompany");
    });

    it("should NOT let a stranger record anything", async function () {
      await expect(
        driveOutcomes.connect(stranger).recordStage(driveId, student1.address, Stage.Offered, "", "")
      ).to.be.revertedWithCustomError(driveOutcomes, "NotDriveCompany");
    });

    it("should refuse a subject who is not a registered Student", async function () {
      await expect(
        driveOutcomes.connect(company1).recordStage(driveId, company2.address, Stage.Offered, "", "")
      )
        .to.be.revertedWithCustomError(driveOutcomes, "NotAStudent")
        .withArgs(company2.address);
    });
  });

  // ===========================================================================
  describe("Recording stages — the drive must be live", function () {
    it("should refuse a drive that was never posted", async function () {
      await expect(
        driveOutcomes.connect(company1).recordStage(999, student1.address, Stage.Offered, "", "")
      )
        .to.be.revertedWithCustomError(driveOutcomes, "DriveNotOpen")
        .withArgs(999);
    });

    it("should refuse a drive the college hasn't approved yet", async function () {
      const id = Number(await placementDrive.nextDriveId());
      await placementDrive
        .connect(company1)
        .postDrive(college1.address, "SDE", 650000, 700, BATCH, DEADLINE, DRIVE_DATE, CID);
      await expect(
        driveOutcomes.connect(company1).recordStage(id, student1.address, Stage.Shortlisted, "", "")
      )
        .to.be.revertedWithCustomError(driveOutcomes, "DriveNotOpen")
        .withArgs(id);
    });

    it("should refuse a cancelled drive", async function () {
      const id = await openDrive();
      await placementDrive.connect(company1).cancelDrive(id);
      await expect(
        driveOutcomes.connect(company1).recordStage(id, student1.address, Stage.Offered, "", "")
      ).to.be.revertedWithCustomError(driveOutcomes, "DriveNotOpen");
    });

    it("should still allow outcomes after applications close", async function () {
      // Results arrive after the deadline. Closing applications must not freeze
      // the process for students already in it.
      const id = await openDrive();
      await placementDrive.connect(company1).closeDrive(id);
      await expect(
        driveOutcomes.connect(company1).recordStage(id, student1.address, Stage.Offered, "", "")
      ).to.not.be.reverted;
    });
  });

  // ===========================================================================
  describe("Recording stages — input bounds and history", function () {
    let driveId;
    beforeEach(async function () {
      driveId = await openDrive();
    });

    it("should refuse Stage.None", async function () {
      await expect(
        driveOutcomes.connect(company1).recordStage(driveId, student1.address, Stage.None, "", "")
      ).to.be.revertedWithCustomError(driveOutcomes, "InvalidStage");
    });

    it("should refuse recording the same stage twice in a row", async function () {
      await driveOutcomes.connect(company1).recordStage(driveId, student1.address, Stage.Interview, "", "");
      await expect(
        driveOutcomes.connect(company1).recordStage(driveId, student1.address, Stage.Interview, "", "")
      )
        .to.be.revertedWithCustomError(driveOutcomes, "StageUnchanged")
        .withArgs(driveId, student1.address, Stage.Interview);
    });

    it("should bound the company's own label", async function () {
      await expect(
        driveOutcomes
          .connect(company1)
          .recordStage(driveId, student1.address, Stage.Interview, "L".repeat(61), "")
      )
        .to.be.revertedWithCustomError(driveOutcomes, "LabelTooLong")
        .withArgs(61);
    });

    it("should bound the ipfs hash, but allow it to be empty", async function () {
      await expect(
        driveOutcomes
          .connect(company1)
          .recordStage(driveId, student1.address, Stage.Interview, "", "Q".repeat(201))
      )
        .to.be.revertedWithCustomError(driveOutcomes, "IpfsHashTooLong")
        .withArgs(201);

      await expect(
        driveOutcomes.connect(company1).recordStage(driveId, student1.address, Stage.Interview, "", "")
      ).to.not.be.reverted;
    });

    it("should measure the label in bytes, not characters", async function () {
      await expect(
        driveOutcomes
          .connect(company1)
          .recordStage(driveId, student1.address, Stage.Interview, "अ".repeat(21), "")
      )
        .to.be.revertedWithCustomError(driveOutcomes, "LabelTooLong")
        .withArgs(63);
    });

    it("should append rather than overwrite, keeping the whole path", async function () {
      await driveOutcomes.connect(company1).recordStage(driveId, student1.address, Stage.Shortlisted, "Screen", "");
      await driveOutcomes.connect(company1).recordStage(driveId, student1.address, Stage.Assessment, "Aptitude", "");
      await driveOutcomes.connect(company1).recordStage(driveId, student1.address, Stage.Interview, "Tech Round 2", "");
      await driveOutcomes.connect(company1).recordStage(driveId, student1.address, Stage.NotSelected, "", "");

      const records = await driveOutcomes.getHistory(driveId, student1.address);
      expect(records.length).to.equal(4);
      expect(records.map((r) => Number(r.stage))).to.deep.equal([
        Stage.Shortlisted,
        Stage.Assessment,
        Stage.Interview,
        Stage.NotSelected,
      ]);
      expect(records[2].label).to.equal("Tech Round 2");
      expect(await driveOutcomes.getHistoryLength(driveId, student1.address)).to.equal(4);
    });

    it("should let a company describe its own rounds while the stage stays canonical", async function () {
      // A fixed stage set keeps funnels comparable across companies; the label
      // keeps it honest about the actual process.
      await driveOutcomes.connect(company1).recordStage(driveId, student1.address, Stage.Interview, "HR Round", "");
      const [record] = await driveOutcomes.getHistory(driveId, student1.address);
      expect(Number(record.stage)).to.equal(Stage.Interview);
      expect(record.label).to.equal("HR Round");
    });

    it("should keep separate histories per student and per drive", async function () {
      const other = await openDrive(company2);
      await driveOutcomes.connect(company1).recordStage(driveId, student1.address, Stage.Shortlisted, "", "");
      await driveOutcomes.connect(company2).recordStage(other, student1.address, Stage.Interview, "", "");
      await driveOutcomes.connect(company1).recordStage(driveId, student2.address, Stage.NotSelected, "", "");

      expect(await driveOutcomes.currentStage(driveId, student1.address)).to.equal(Stage.Shortlisted);
      expect(await driveOutcomes.currentStage(other, student1.address)).to.equal(Stage.Interview);
      expect(await driveOutcomes.currentStage(driveId, student2.address)).to.equal(Stage.NotSelected);
    });
  });

  // ===========================================================================
  describe("Answering an offer — only the student", function () {
    let driveId;
    beforeEach(async function () {
      driveId = await openDrive();
      await driveOutcomes.connect(company1).recordStage(driveId, student1.address, Stage.Offered, "Final", "");
    });

    it("should let the student accept", async function () {
      await expect(driveOutcomes.connect(student1).answerOffer(driveId, Answer.Accepted))
        .to.emit(driveOutcomes, "OfferAnswered")
        .withArgs(driveId, student1.address, Answer.Accepted, (t) => t > 0);
      expect(await driveOutcomes.offerResponse(driveId, student1.address)).to.equal(Answer.Accepted);
    });

    it("should let the student decline", async function () {
      await driveOutcomes.connect(student1).answerOffer(driveId, Answer.Declined);
      expect(await driveOutcomes.isPlaced(student1.address)).to.be.false;
    });

    it("should NOT let the company answer on the student's behalf", async function () {
      // Otherwise a company could count a placement the student never agreed to.
      await expect(
        driveOutcomes.connect(company1).answerOffer(driveId, Answer.Accepted)
      ).to.be.revertedWithCustomError(driveOutcomes, "NoStandingOffer");
    });

    it("should NOT let the college answer", async function () {
      await expect(
        driveOutcomes.connect(college1).answerOffer(driveId, Answer.Accepted)
      ).to.be.revertedWithCustomError(driveOutcomes, "NoStandingOffer");
    });

    it("should NOT let another student answer someone else's offer", async function () {
      await expect(
        driveOutcomes.connect(student2).answerOffer(driveId, Answer.Accepted)
      )
        .to.be.revertedWithCustomError(driveOutcomes, "NoStandingOffer")
        .withArgs(driveId, student2.address);
    });

    it("should refuse an answer when no offer was made", async function () {
      const other = await openDrive(company2);
      await expect(driveOutcomes.connect(student1).answerOffer(other, Answer.Accepted))
        .to.be.revertedWithCustomError(driveOutcomes, "NoStandingOffer")
        .withArgs(other, student1.address);
    });

    it("should refuse a second answer to the same offer", async function () {
      await driveOutcomes.connect(student1).answerOffer(driveId, Answer.Accepted);
      await expect(driveOutcomes.connect(student1).answerOffer(driveId, Answer.Declined))
        .to.be.revertedWithCustomError(driveOutcomes, "OfferAlreadyAnswered")
        .withArgs(driveId, student1.address, Answer.Accepted);
    });

    it("should refuse OfferResponse.None", async function () {
      await expect(
        driveOutcomes.connect(student1).answerOffer(driveId, Answer.None)
      ).to.be.revertedWithCustomError(driveOutcomes, "InvalidOfferResponse");
    });
  });

  // ===========================================================================
  describe("Placement — only an accepted offer counts", function () {
    let driveId;
    beforeEach(async function () {
      driveId = await openDrive();
    });

    it("should not count an offer that was never answered", async function () {
      await driveOutcomes.connect(company1).recordStage(driveId, student1.address, Stage.Offered, "", "");
      expect(await driveOutcomes.isPlaced(student1.address)).to.be.false;
      expect(await driveOutcomes.placedCount(college1.address, BATCH)).to.equal(0);
    });

    it("should not count a declined offer", async function () {
      await driveOutcomes.connect(company1).recordStage(driveId, student1.address, Stage.Offered, "", "");
      await driveOutcomes.connect(student1).answerOffer(driveId, Answer.Declined);
      expect(await driveOutcomes.isPlaced(student1.address)).to.be.false;
      expect(await driveOutcomes.placedCount(college1.address, BATCH)).to.equal(0);
    });

    it("should count an accepted offer and announce it", async function () {
      await driveOutcomes.connect(company1).recordStage(driveId, student1.address, Stage.Offered, "", "");
      await expect(driveOutcomes.connect(student1).answerOffer(driveId, Answer.Accepted))
        .to.emit(driveOutcomes, "PlacementChanged")
        .withArgs(student1.address, college1.address, BATCH, true, 1);

      expect(await driveOutcomes.isPlaced(student1.address)).to.be.true;
      expect(await driveOutcomes.placedCount(college1.address, BATCH)).to.equal(1);
    });

    it("should count each placed student once, however many offers they accept", async function () {
      const other = await openDrive(company2);
      await acceptOffer(driveId, company1, student1);
      await acceptOffer(other, company2, student1);

      expect(await driveOutcomes.standingAcceptedOffers(student1.address)).to.equal(2);
      expect(await driveOutcomes.placedCount(college1.address, BATCH)).to.equal(1);
    });

    it("should count several students separately", async function () {
      await acceptOffer(driveId, company1, student1);
      await acceptOffer(driveId, company1, student2);
      expect(await driveOutcomes.placedCount(college1.address, BATCH)).to.equal(2);
    });
  });

  // ===========================================================================
  describe("Placement — a withdrawn offer un-places the student", function () {
    let driveId;
    beforeEach(async function () {
      driveId = await openDrive();
      await acceptOffer(driveId, company1, student1);
    });

    it("should drop the count when the company withdraws the offer", async function () {
      // A figure that only ever rises is not a measurement.
      await expect(
        driveOutcomes
          .connect(company1)
          .recordStage(driveId, student1.address, Stage.NotSelected, "Withdrawn", "")
      )
        .to.emit(driveOutcomes, "PlacementChanged")
        .withArgs(student1.address, college1.address, BATCH, false, 0);

      expect(await driveOutcomes.isPlaced(student1.address)).to.be.false;
      expect(await driveOutcomes.placedCount(college1.address, BATCH)).to.equal(0);
    });

    it("should keep the student placed if another accepted offer still stands", async function () {
      const other = await openDrive(company2);
      await acceptOffer(other, company2, student1);
      expect(await driveOutcomes.placedCount(college1.address, BATCH)).to.equal(1);

      await driveOutcomes.connect(company1).recordStage(driveId, student1.address, Stage.NotSelected, "", "");

      expect(await driveOutcomes.isPlaced(student1.address)).to.be.true;
      expect(await driveOutcomes.placedCount(college1.address, BATCH)).to.equal(1);
      expect(await driveOutcomes.standingAcceptedOffers(student1.address)).to.equal(1);
    });

    it("should un-place only once both accepted offers are withdrawn", async function () {
      const other = await openDrive(company2);
      await acceptOffer(other, company2, student1);

      await driveOutcomes.connect(company1).recordStage(driveId, student1.address, Stage.NotSelected, "", "");
      expect(await driveOutcomes.isPlaced(student1.address)).to.be.true;

      await driveOutcomes.connect(company2).recordStage(other, student1.address, Stage.NotSelected, "", "");
      expect(await driveOutcomes.isPlaced(student1.address)).to.be.false;
      expect(await driveOutcomes.placedCount(college1.address, BATCH)).to.equal(0);
    });

    it("should not change the count when an unanswered offer is withdrawn", async function () {
      await driveOutcomes.connect(company1).recordStage(driveId, student2.address, Stage.Offered, "", "");
      const before = await driveOutcomes.placedCount(college1.address, BATCH);
      await driveOutcomes.connect(company1).recordStage(driveId, student2.address, Stage.NotSelected, "", "");
      expect(await driveOutcomes.placedCount(college1.address, BATCH)).to.equal(before);
    });

    it("should keep the full history after a withdrawal", async function () {
      await driveOutcomes.connect(company1).recordStage(driveId, student1.address, Stage.NotSelected, "Withdrawn", "");
      const records = await driveOutcomes.getHistory(driveId, student1.address);
      expect(records.length).to.equal(2);
      expect(Number(records[0].stage)).to.equal(Stage.Offered);
      expect(Number(records[1].stage)).to.equal(Stage.NotSelected);
      // The acceptance is not erased either — it happened.
      expect(await driveOutcomes.offerResponse(driveId, student1.address)).to.equal(Answer.Accepted);
    });

    it("should decrement the cohort the student was counted under, not another", async function () {
      // Offers can come from drives aimed at different years; undoing a count
      // where it was never made would corrupt both totals.
      const otherYearDrive = await openDrive(company2, college1, 2027);
      await acceptOffer(otherYearDrive, company2, student2);
      expect(await driveOutcomes.placedCount(college1.address, 2027)).to.equal(1);

      await driveOutcomes.connect(company2).recordStage(otherYearDrive, student2.address, Stage.NotSelected, "", "");
      expect(await driveOutcomes.placedCount(college1.address, 2027)).to.equal(0);
      expect(await driveOutcomes.placedCount(college1.address, BATCH)).to.equal(1); // student1 untouched
    });
  });

  // ===========================================================================
  describe("placementFor — numerator and denominator together", function () {
    it("should pair placed students with the cohort the college declared", async function () {
      const driveId = await openDrive();
      await acceptOffer(driveId, company1, student1);

      const [placed, declared] = await driveOutcomes.placementFor(college1.address, "CSE", BATCH);
      expect(placed).to.equal(1);
      expect(declared).to.equal(180);
    });

    it("should report a declared size of zero for an undeclared cohort", async function () {
      const [placed, declared] = await driveOutcomes.placementFor(college1.address, "CIVIL", BATCH);
      expect(placed).to.equal(0);
      expect(declared).to.equal(0);
    });

    it("should follow the college's revision of the cohort size", async function () {
      // The denominator is read from ActorRegistry rather than copied here, so
      // there is exactly one on-chain source and no chance of two drifting.
      const driveId = await openDrive();
      await acceptOffer(driveId, company1, student1);
      await actorRegistry.connect(college1).recordBatchStrength("CSE", BATCH, 60);

      const [placed, declared] = await driveOutcomes.placementFor(college1.address, "CSE", BATCH);
      expect(placed).to.equal(1);
      expect(declared).to.equal(60);
    });
  });
});
