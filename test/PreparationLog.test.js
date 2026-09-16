const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * PreparationLog — the college's record of what it did to prepare students.
 *
 * This is the one contract where the college is the author rather than the
 * subject, so the property worth protecting is narrower than elsewhere: nobody
 * else may write into a college's record, and the college may not quietly
 * revise its own. A log that can be topped up in June is not evidence of
 * anything, which is the whole reason for recording it on a chain rather than
 * in a spreadsheet.
 */
describe("PreparationLog", function () {
  let actorRegistry, preparationLog;
  let deployer, verifier, college1, college2, company1, student1, stranger;

  const Role = { None: 0, Student: 1, College: 2, Company: 3 };
  const Kind = { None: 0, Training: 1, MockInterview: 2, Workshop: 3, Seminar: 4, Other: 5 };
  const ZERO_ADDRESS = ethers.ZeroAddress;
  const CID = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
  const BATCH = 2026;
  let HELD_ON;

  beforeEach(async function () {
    [deployer, verifier, college1, college2, company1, student1, stranger] =
      await ethers.getSigners();

    const ActorRegistry = await ethers.getContractFactory("ActorRegistry");
    actorRegistry = await ActorRegistry.deploy(verifier.address);

    const PreparationLog = await ethers.getContractFactory("PreparationLog");
    preparationLog = await PreparationLog.deploy(await actorRegistry.getAddress());

    HELD_ON = (await ethers.provider.getBlock("latest")).timestamp - 24 * 60 * 60;

    await registerActiveCollege(college1, "IIT Bombay");
    await registerActiveCollege(college2, "Other Institute");
    await actorRegistry.connect(company1).register(Role.Company, "Infosys", "", ZERO_ADDRESS);
    await actorRegistry.connect(college1).approveActor(company1.address);
    await actorRegistry.connect(student1).register(Role.Student, "A Student", "", college1.address);
  });

  async function registerActiveCollege(signer, name) {
    await actorRegistry.connect(signer).register(Role.College, name, "", ZERO_ADDRESS);
    await actorRegistry.connect(verifier).approveActor(signer.address);
  }

  function record(signer = college1, overrides = {}) {
    const e = {
      kind: Kind.Training,
      title: "Aptitude Test Series - Round 3",
      conductedBy: "Placement Cell",
      heldOn: HELD_ON,
      attendance: 142,
      batchYear: BATCH,
      ipfsHash: CID,
      ...overrides,
    };
    return preparationLog
      .connect(signer)
      .recordEvent(e.kind, e.title, e.conductedBy, e.heldOn, e.attendance, e.batchYear, e.ipfsHash);
  }

  // --- deployment -----------------------------------------------------------

  describe("Deployment", function () {
    it("1. holds the registry it was given", async function () {
      expect(await preparationLog.actorRegistry()).to.equal(await actorRegistry.getAddress());
    });

    it("2. refuses a zero registry address", async function () {
      const PreparationLog = await ethers.getContractFactory("PreparationLog");
      await expect(PreparationLog.deploy(ZERO_ADDRESS)).to.be.revertedWithCustomError(
        preparationLog,
        "InvalidRegistryAddress"
      );
    });
  });

  // --- who may write --------------------------------------------------------

  describe("Authorship", function () {
    it("3. an Active college records an event", async function () {
      await expect(record())
        .to.emit(preparationLog, "PreparationRecorded")
        .withArgs(0, college1.address, Kind.Training, "Aptitude Test Series - Round 3", HELD_ON, 142, BATCH);

      const e = await preparationLog.getPreparationEvent(0);
      expect(e.college).to.equal(college1.address);
      expect(e.conductedBy).to.equal("Placement Cell");
      expect(e.attendance).to.equal(142);
      expect(e.cancelled).to.equal(false);
    });

    it("4. a company cannot record preparation work", async function () {
      // A company claiming credit for a college's training would be the same
      // category of error as a college authoring a company's offer.
      await expect(record(company1)).to.be.revertedWithCustomError(preparationLog, "NotActiveCollege");
    });

    it("5. a student cannot record preparation work", async function () {
      await expect(record(student1)).to.be.revertedWithCustomError(preparationLog, "NotActiveCollege");
    });

    it("6. a stranger with no role cannot record preparation work", async function () {
      await expect(record(stranger)).to.be.revertedWithCustomError(preparationLog, "NotActiveCollege");
    });

    it("7. a Pending college cannot record until it is approved", async function () {
      const [, , , , , , , pending] = await ethers.getSigners();
      await actorRegistry.connect(pending).register(Role.College, "Unapproved", "", ZERO_ADDRESS);
      await expect(record(pending)).to.be.revertedWithCustomError(preparationLog, "NotActiveCollege");
    });

    it("8. a suspended college cannot record until it is reinstated", async function () {
      await actorRegistry.connect(verifier).suspendActor(college1.address, "under review");
      await expect(record()).to.be.revertedWithCustomError(preparationLog, "NotActiveCollege");

      await actorRegistry.connect(verifier).reinstateActor(college1.address);
      await expect(record()).to.emit(preparationLog, "PreparationRecorded");
    });
  });

  // --- what may be written --------------------------------------------------

  describe("Bounds", function () {
    it("9. refuses the None kind", async function () {
      await expect(record(college1, { kind: Kind.None })).to.be.revertedWithCustomError(
        preparationLog,
        "InvalidEventKind"
      );
    });

    it("10. refuses an empty or oversized title", async function () {
      await expect(record(college1, { title: "" })).to.be.revertedWithCustomError(
        preparationLog,
        "InvalidTitleLength"
      );
      await expect(record(college1, { title: "x".repeat(121) })).to.be.revertedWithCustomError(
        preparationLog,
        "InvalidTitleLength"
      );
    });

    it("11. measures the title in bytes, not characters", async function () {
      // 41 Devanagari characters are ~123 bytes. A limit counted in characters
      // would accept this and the transaction would revert anyway; the backend
      // measures bytes for the same reason.
      const devanagari = "अ".repeat(41);
      expect(Buffer.byteLength(devanagari, "utf8")).to.be.greaterThan(120);
      await expect(record(college1, { title: devanagari })).to.be.revertedWithCustomError(
        preparationLog,
        "InvalidTitleLength"
      );
    });

    it("12. refuses an empty conductedBy", async function () {
      await expect(record(college1, { conductedBy: "" })).to.be.revertedWithCustomError(
        preparationLog,
        "InvalidConductedByLength"
      );
    });

    it("13. refuses a zero date or one implausibly far ahead", async function () {
      await expect(record(college1, { heldOn: 0 })).to.be.revertedWithCustomError(
        preparationLog,
        "InvalidHeldOnDate"
      );
      const twoYearsOut = HELD_ON + 2 * 365 * 24 * 60 * 60;
      await expect(record(college1, { heldOn: twoYearsOut })).to.be.revertedWithCustomError(
        preparationLog,
        "InvalidHeldOnDate"
      );
    });

    it("14. accepts a session scheduled within the year ahead", async function () {
      // A college may record something it has committed to running.
      const nextMonth = HELD_ON + 30 * 24 * 60 * 60;
      await expect(record(college1, { heldOn: nextMonth })).to.emit(preparationLog, "PreparationRecorded");
    });

    it("15. refuses an implausible attendance figure", async function () {
      await expect(record(college1, { attendance: 100001 })).to.be.revertedWithCustomError(
        preparationLog,
        "InvalidAttendance"
      );
    });

    it("16. accepts zero attendance, which is a real outcome", async function () {
      // A session nobody turned up to is a fact worth recording, not an error.
      await expect(record(college1, { attendance: 0 })).to.emit(preparationLog, "PreparationRecorded");
    });

    it("17. accepts batch year 0 as open to all, but refuses a wrong one", async function () {
      await expect(record(college1, { batchYear: 0 })).to.emit(preparationLog, "PreparationRecorded");
      await expect(record(college1, { batchYear: 1990 })).to.be.revertedWithCustomError(
        preparationLog,
        "InvalidBatchYear"
      );
    });

    it("18. accepts an empty ipfs hash but not an oversized one", async function () {
      await expect(record(college1, { ipfsHash: "" })).to.emit(preparationLog, "PreparationRecorded");
      await expect(record(college1, { ipfsHash: "Q".repeat(201) })).to.be.revertedWithCustomError(
        preparationLog,
        "IpfsHashTooLong"
      );
    });
  });

  // --- the record cannot be quietly revised ---------------------------------

  describe("Permanence", function () {
    it("19. exposes no way to edit a recorded event", async function () {
      // The point of the contract. If an entry could be edited, a college could
      // restate a session nobody attended as one that filled the hall.
      const writable = preparationLog.interface.fragments
        .filter((f) => f.type === "function" && f.stateMutability !== "view" && f.stateMutability !== "pure")
        .map((f) => f.name)
        .sort();
      expect(writable).to.deep.equal(["cancelEvent", "recordEvent"]);
    });

    it("20. records the timestamp it was written, not just the date claimed", async function () {
      // This is what separates a log kept as the year went from one assembled
      // afterwards: the claimed date is the college's word, recordedAt is not.
      await record();
      const e = await preparationLog.getPreparationEvent(0);
      const block = await ethers.provider.getBlock("latest");
      expect(e.recordedAt).to.equal(block.timestamp);
      expect(e.heldOn).to.equal(HELD_ON);
    });

    it("21. cancelling leaves the original visible beside the cancellation", async function () {
      await record();
      await expect(preparationLog.connect(college1).cancelEvent(0, "Called off - trainer unavailable"))
        .to.emit(preparationLog, "PreparationCancelled")
        .withArgs(0, college1.address, "Called off - trainer unavailable");

      const e = await preparationLog.getPreparationEvent(0);
      expect(e.cancelled).to.equal(true);
      // Nothing about what was originally claimed is erased.
      expect(e.title).to.equal("Aptitude Test Series - Round 3");
      expect(e.attendance).to.equal(142);
    });

    it("22. only the authoring college may cancel", async function () {
      await record();
      await expect(
        preparationLog.connect(college2).cancelEvent(0, "not mine")
      ).to.be.revertedWithCustomError(preparationLog, "NotEventAuthor");
      await expect(
        preparationLog.connect(verifier).cancelEvent(0, "admin knows best")
      ).to.be.revertedWithCustomError(preparationLog, "NotEventAuthor");
    });

    it("23. an event cannot be cancelled twice", async function () {
      await record();
      await preparationLog.connect(college1).cancelEvent(0, "once");
      await expect(
        preparationLog.connect(college1).cancelEvent(0, "again")
      ).to.be.revertedWithCustomError(preparationLog, "EventAlreadyCancelled");
    });

    it("24. cancelling an event that does not exist is refused", async function () {
      await expect(
        preparationLog.connect(college1).cancelEvent(99, "no such thing")
      ).to.be.revertedWithCustomError(preparationLog, "EventNotFound");
    });
  });

  // --- counting -------------------------------------------------------------

  describe("Counting", function () {
    it("25. the standing count rises with each event and falls on cancellation", async function () {
      // Otherwise a college could record ten sessions, cancel nine, and still
      // show ten on the public page.
      await record();
      await record(college1, { title: "Mock Interviews - CSE", kind: Kind.MockInterview });
      expect(await preparationLog.standingEventCount(college1.address)).to.equal(2);

      await preparationLog.connect(college1).cancelEvent(0, "did not happen");
      expect(await preparationLog.standingEventCount(college1.address)).to.equal(1);
      // The total ever recorded does not fall — both remain readable.
      expect(await preparationLog.collegeEventCount(college1.address)).to.equal(2);
    });

    it("26. one college's events never appear under another", async function () {
      await record(college1);
      await record(college2, { title: "Their own workshop" });

      const mine = await preparationLog.getCollegeEventIds(college1.address);
      const theirs = await preparationLog.getCollegeEventIds(college2.address);
      expect(mine.map(Number)).to.deep.equal([0]);
      expect(theirs.map(Number)).to.deep.equal([1]);
      expect(await preparationLog.standingEventCount(college2.address)).to.equal(1);
    });

    it("27. ids are globally unique and handed out in order", async function () {
      await record(college1);
      await record(college2);
      await record(college1);
      expect(await preparationLog.nextEventId()).to.equal(3);
      expect((await preparationLog.getCollegeEventIds(college1.address)).map(Number)).to.deep.equal([0, 2]);
    });

    it("28. reading an event that does not exist is refused", async function () {
      await expect(preparationLog.getPreparationEvent(0)).to.be.revertedWithCustomError(
        preparationLog,
        "EventNotFound"
      );
    });
  });
});
