const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * One whole placement season, end to end across all three v2 contracts.
 *
 * The unit tests prove each contract refuses what it should. This one asks a
 * different question: do the pieces actually add up to a number a parent could
 * read and trust? It walks a realistic season — a drive, a funnel, offers,
 * one declined, one withdrawn — and checks the published figure at the end
 * against what genuinely happened.
 */
describe("v2 — a full placement season", function () {
  let actorRegistry, placementDrive, driveOutcomes;
  let verifier, college, infosys, rival;
  let students;

  const Role = { None: 0, Student: 1, College: 2, Company: 3 };
  const Stage = { None: 0, Shortlisted: 1, Assessment: 2, Interview: 3, Offered: 4, NotSelected: 5 };
  const Answer = { None: 0, Accepted: 1, Declined: 2 };
  const ZERO = ethers.ZeroAddress;
  const CID = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
  const BATCH = 2026;

  let DEADLINE, DRIVE_DATE;

  before(async function () {
    const signers = await ethers.getSigners();
    [, verifier, college, infosys, rival] = signers;
    students = signers.slice(5, 11); // six students

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
  });

  it("1. the college is admitted by the verifier", async function () {
    await actorRegistry.connect(college).register(Role.College, "IIT Bombay", "", ZERO);
    await actorRegistry.connect(verifier).approveActor(college.address);
    expect(await actorRegistry.isActive(college.address)).to.be.true;
  });

  it("2. the college declares the cohort — the denominator, in public", async function () {
    await expect(actorRegistry.connect(college).recordBatchStrength("CSE", BATCH, 180))
      .to.emit(actorRegistry, "BatchStrengthRecorded")
      .withArgs(college.address, "CSE", BATCH, 0, 180);
  });

  it("3. six students register under it", async function () {
    for (let i = 0; i < students.length; i++) {
      await actorRegistry.connect(students[i]).register(Role.Student, `Student ${i}`, "", college.address);
    }
    expect(await actorRegistry.totalRegisteredStudents(college.address)).to.equal(6);
  });

  it("4. two companies register themselves; the college admits them", async function () {
    await actorRegistry.connect(infosys).register(Role.Company, "Infosys", "", ZERO);
    await actorRegistry.connect(rival).register(Role.Company, "Rival Ltd", "", ZERO);
    await actorRegistry.connect(college).approveActor(infosys.address);
    await actorRegistry.connect(college).approveActor(rival.address);
    expect(await actorRegistry.isActive(infosys.address)).to.be.true;
  });

  it("5. a company posts its own terms; the college only agrees to host", async function () {
    await placementDrive
      .connect(infosys)
      .postDrive(college.address, "Software Engineer", 650000, 700, BATCH, DEADLINE, DRIVE_DATE, CID);
    await placementDrive.connect(college).approveDrive(0);

    const drive = await placementDrive.getDrive(0);
    expect(drive.company).to.equal(infosys.address);
    expect(drive.annualPackage).to.equal(650000);
    expect(drive.status).to.equal(2); // Approved
  });

  it("6. the college cannot write outcomes for that drive", async function () {
    await expect(
      driveOutcomes.connect(college).recordStage(0, students[0].address, Stage.Offered, "", "")
    ).to.be.revertedWithCustomError(driveOutcomes, "NotDriveCompany");
  });

  it("7. the company runs its funnel: 6 shortlisted, 4 interviewed, 3 offered", async function () {
    for (const s of students) {
      await driveOutcomes.connect(infosys).recordStage(0, s.address, Stage.Shortlisted, "Screening", "");
    }
    // Two drop out at the assessment.
    for (const s of students.slice(0, 4)) {
      await driveOutcomes.connect(infosys).recordStage(0, s.address, Stage.Interview, "Tech Round", "");
    }
    for (const s of students.slice(4)) {
      await driveOutcomes.connect(infosys).recordStage(0, s.address, Stage.NotSelected, "", "");
    }
    // Three of the four interviewed get offers.
    for (const s of students.slice(0, 3)) {
      await driveOutcomes.connect(infosys).recordStage(0, s.address, Stage.Offered, "Final", "");
    }
    await driveOutcomes.connect(infosys).recordStage(0, students[3].address, Stage.NotSelected, "", "");

    expect(await driveOutcomes.currentStage(0, students[0].address)).to.equal(Stage.Offered);
    expect(await driveOutcomes.currentStage(0, students[5].address)).to.equal(Stage.NotSelected);
  });

  it("8. the company states how many applied — the first bar of the funnel", async function () {
    // Written by the company, not the college: it is the college's conversion
    // rate this number shapes, so the college is exactly who must not author it.
    await placementDrive.connect(infosys).recordApplicationCount(0, 140);
    const [count, recorded] = await placementDrive.getApplicationCount(0);
    expect(count).to.equal(140);
    expect(recorded).to.be.true;

    await expect(
      placementDrive.connect(college).recordApplicationCount(0, 20)
    ).to.be.revertedWithCustomError(placementDrive, "NotAuthorizedForDrive");
  });

  it("9. nobody is placed until a student says yes", async function () {
    // Three offers stand, and the placed count is still zero.
    for (const s of students.slice(0, 3)) {
      expect(await driveOutcomes.isPlaced(s.address)).to.be.false;
    }
    expect(await driveOutcomes.placedCount(college.address, BATCH)).to.equal(0);
  });

  it("10. two accept, one declines", async function () {
    await driveOutcomes.connect(students[0]).answerOffer(0, Answer.Accepted);
    await driveOutcomes.connect(students[1]).answerOffer(0, Answer.Accepted);
    await driveOutcomes.connect(students[2]).answerOffer(0, Answer.Declined);

    expect(await driveOutcomes.placedCount(college.address, BATCH)).to.equal(2);
    expect(await driveOutcomes.isPlaced(students[2].address)).to.be.false;
  });

  it("11. a second company runs a drive; the student who declined takes its offer", async function () {
    await placementDrive
      .connect(rival)
      .postDrive(college.address, "Analyst", 800000, 650, BATCH, DEADLINE, DRIVE_DATE, CID);
    await placementDrive.connect(college).approveDrive(1);

    await driveOutcomes.connect(rival).recordStage(1, students[2].address, Stage.Offered, "Final", "");
    await driveOutcomes.connect(students[2]).answerOffer(1, Answer.Accepted);

    expect(await driveOutcomes.placedCount(college.address, BATCH)).to.equal(3);
  });

  it("12. a student holding two accepted offers is still counted once", async function () {
    await driveOutcomes.connect(rival).recordStage(1, students[0].address, Stage.Offered, "Final", "");
    await driveOutcomes.connect(students[0]).answerOffer(1, Answer.Accepted);

    expect(await driveOutcomes.standingAcceptedOffers(students[0].address)).to.equal(2);
    expect(await driveOutcomes.placedCount(college.address, BATCH)).to.equal(3);
  });

  it("13. one company withdraws an offer — the count falls", async function () {
    // student[1] had exactly one accepted offer, so this un-places them.
    await driveOutcomes.connect(infosys).recordStage(0, students[1].address, Stage.NotSelected, "Withdrawn", "");

    expect(await driveOutcomes.isPlaced(students[1].address)).to.be.false;
    expect(await driveOutcomes.placedCount(college.address, BATCH)).to.equal(2);
  });

  it("14. withdrawing one of two offers leaves the student placed", async function () {
    await driveOutcomes.connect(infosys).recordStage(0, students[0].address, Stage.NotSelected, "Withdrawn", "");

    expect(await driveOutcomes.isPlaced(students[0].address)).to.be.true;
    expect(await driveOutcomes.standingAcceptedOffers(students[0].address)).to.equal(1);
    expect(await driveOutcomes.placedCount(college.address, BATCH)).to.equal(2);
  });

  it("15. the published figure matches what actually happened", async function () {
    // Two students hold a standing accepted offer: student[0] (Rival) and
    // student[2] (Rival). Against a cohort of 180 the college declared itself.
    const [placed, declared] = await driveOutcomes.placementFor(college.address, "CSE", BATCH);
    expect(placed).to.equal(2);
    expect(declared).to.equal(180);
  });

  it("16. shrinking the cohort is allowed, but never silent", async function () {
    // The move that inflates a placement rate without anyone technically lying.
    // It still works — and it is now a permanent, public edit showing 180 -> 60.
    await expect(actorRegistry.connect(college).recordBatchStrength("CSE", BATCH, 60))
      .to.emit(actorRegistry, "BatchStrengthRecorded")
      .withArgs(college.address, "CSE", BATCH, 180, 60);

    const [placed, declared] = await driveOutcomes.placementFor(college.address, "CSE", BATCH);
    expect(placed).to.equal(2);
    expect(declared).to.equal(60);
  });

  it("17. the whole path for one student is still readable", async function () {
    const records = await driveOutcomes.getHistory(0, students[0].address);
    expect(records.map((r) => Number(r.stage))).to.deep.equal([
      Stage.Shortlisted,
      Stage.Interview,
      Stage.Offered,
      Stage.NotSelected,
    ]);
    // Nothing was edited away: the acceptance still stands in the record even
    // though the offer behind it was withdrawn.
    expect(await driveOutcomes.offerResponse(0, students[0].address)).to.equal(Answer.Accepted);
  });
});
