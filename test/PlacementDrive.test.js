const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * PlacementDrive — the record of what a company came to offer.
 *
 * The property these tests exist to protect: the company writes the terms, the
 * college decides only whether the drive may run. If a college could edit a
 * package or a cutoff, the platform would be back to a college describing its
 * own placement results, which is the thing it replaces.
 */
describe("PlacementDrive", function () {
  let actorRegistry, placementDrive;
  let deployer, verifier, college1, college2, company1, company2, student1, stranger;

  const Role = { None: 0, Student: 1, College: 2, Company: 3 };
  const DriveStatus = {
    None: 0,
    Proposed: 1,
    Approved: 2,
    Rejected: 3,
    Closed: 4,
    Cancelled: 5,
  };
  const ZERO_ADDRESS = ethers.ZeroAddress;
  const CID = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";

  // A plausible drive: 6.5 LPA SDE role for the 2026 batch, 7.00 CGPA cutoff.
  const PACKAGE = 650000;
  const CGPA = 700;
  const BATCH = 2026;
  let DEADLINE, DRIVE_DATE;

  beforeEach(async function () {
    [deployer, verifier, college1, college2, company1, company2, student1, stranger] =
      await ethers.getSigners();

    const ActorRegistry = await ethers.getContractFactory("ActorRegistry");
    actorRegistry = await ActorRegistry.deploy(verifier.address);

    const PlacementDrive = await ethers.getContractFactory("PlacementDrive");
    placementDrive = await PlacementDrive.deploy(await actorRegistry.getAddress());

    const now = (await ethers.provider.getBlock("latest")).timestamp;
    DEADLINE = now + 7 * 24 * 60 * 60;
    DRIVE_DATE = now + 14 * 24 * 60 * 60;

    await registerActiveCollege(college1, "IIT Bombay");
    await registerActiveCollege(college2, "Other Institute");
    await registerActiveCompany(company1, "Infosys", college1);
    await registerActiveCompany(company2, "Rival Ltd", college1);
    await actorRegistry.connect(student1).register(Role.Student, "A Student", "", college1.address);
  });

  async function registerActiveCollege(signer, name) {
    await actorRegistry.connect(signer).register(Role.College, name, "", ZERO_ADDRESS);
    await actorRegistry.connect(verifier).approveActor(signer.address);
  }

  /** Companies are admitted by an Active College — see ActorRegistry v2. */
  async function registerActiveCompany(signer, name, approvingCollege) {
    await actorRegistry.connect(signer).register(Role.Company, name, "", ZERO_ADDRESS);
    await actorRegistry.connect(approvingCollege).approveActor(signer.address);
  }

  function post(signer = company1, overrides = {}) {
    const args = {
      college: college1.address,
      roleTitle: "Software Engineer",
      annualPackage: PACKAGE,
      minCgpaScaled: CGPA,
      batchYear: BATCH,
      applicationDeadline: DEADLINE,
      driveDate: DRIVE_DATE,
      ipfsHash: CID,
      ...overrides,
    };
    return placementDrive
      .connect(signer)
      .postDrive(
        args.college,
        args.roleTitle,
        args.annualPackage,
        args.minCgpaScaled,
        args.batchYear,
        args.applicationDeadline,
        args.driveDate,
        args.ipfsHash
      );
  }

  // ===========================================================================
  describe("Deployment", function () {
    it("should store the registry address", async function () {
      expect(await placementDrive.actorRegistry()).to.equal(await actorRegistry.getAddress());
    });

    it("should revert deployment with a zero registry address", async function () {
      const PlacementDrive = await ethers.getContractFactory("PlacementDrive");
      await expect(PlacementDrive.deploy(ZERO_ADDRESS)).to.be.revertedWithCustomError(
        placementDrive,
        "InvalidRegistryAddress"
      );
    });

    it("should start with no drives", async function () {
      expect(await placementDrive.nextDriveId()).to.equal(0);
      expect(await placementDrive.driveExists(0)).to.be.false;
    });
  });

  // ===========================================================================
  describe("Posting — only the recruiting company", function () {
    it("should let an Active Company post, landing in Proposed", async function () {
      await expect(post())
        .to.emit(placementDrive, "DrivePosted")
        .withArgs(
          0,
          company1.address,
          college1.address,
          "Software Engineer",
          PACKAGE,
          CGPA,
          BATCH,
          DEADLINE,
          DRIVE_DATE,
          CID
        );

      const drive = await placementDrive.getDrive(0);
      expect(drive.company).to.equal(company1.address);
      expect(drive.college).to.equal(college1.address);
      expect(drive.status).to.equal(DriveStatus.Proposed);
      expect(drive.annualPackage).to.equal(PACKAGE);
    });

    it("should emit the initial status transition from None", async function () {
      await expect(post())
        .to.emit(placementDrive, "DriveStatusChanged")
        .withArgs(0, DriveStatus.None, DriveStatus.Proposed, company1.address);
    });

    it("should NOT let a College post a drive", async function () {
      // The heart of it: a college describing a company's offer is the
      // self-reporting this platform replaces.
      await expect(post(college1))
        .to.be.revertedWithCustomError(placementDrive, "NotActiveCompany")
        .withArgs(college1.address);
    });

    it("should NOT let a Student or a stranger post a drive", async function () {
      await expect(post(student1)).to.be.revertedWithCustomError(placementDrive, "NotActiveCompany");
      await expect(post(stranger)).to.be.revertedWithCustomError(placementDrive, "NotActiveCompany");
    });

    it("should NOT let a Pending company post a drive", async function () {
      const [, , , , , , , , pendingCo] = await ethers.getSigners();
      await actorRegistry.connect(pendingCo).register(Role.Company, "Unapproved Co", "", ZERO_ADDRESS);
      await expect(post(pendingCo))
        .to.be.revertedWithCustomError(placementDrive, "NotActiveCompany")
        .withArgs(pendingCo.address);
    });

    it("should NOT allow posting to a college that isn't Active", async function () {
      await expect(post(company1, { college: stranger.address }))
        .to.be.revertedWithCustomError(placementDrive, "NotActiveCollege")
        .withArgs(stranger.address);
    });

    it("should give each drive a distinct id", async function () {
      await post();
      await post(company2);
      expect(await placementDrive.nextDriveId()).to.equal(2);
      expect((await placementDrive.getDrive(0)).company).to.equal(company1.address);
      expect((await placementDrive.getDrive(1)).company).to.equal(company2.address);
    });
  });

  // ===========================================================================
  describe("Posting — input bounds", function () {
    it("should reject an empty or over-long role title", async function () {
      await expect(post(company1, { roleTitle: "" }))
        .to.be.revertedWithCustomError(placementDrive, "InvalidRoleTitleLength")
        .withArgs(0);
      await expect(post(company1, { roleTitle: "R".repeat(101) }))
        .to.be.revertedWithCustomError(placementDrive, "InvalidRoleTitleLength")
        .withArgs(101);
    });

    it("should measure the role title in bytes, not characters", async function () {
      // 40 Devanagari characters are 120 bytes — over the 100-byte limit, even
      // though a character count would pass.
      await expect(post(company1, { roleTitle: "अ".repeat(40) }))
        .to.be.revertedWithCustomError(placementDrive, "InvalidRoleTitleLength")
        .withArgs(120);
    });

    it("should reject an empty or over-long ipfs hash", async function () {
      await expect(post(company1, { ipfsHash: "" }))
        .to.be.revertedWithCustomError(placementDrive, "InvalidIpfsHashLength")
        .withArgs(0);
      await expect(post(company1, { ipfsHash: "Q".repeat(201) }))
        .to.be.revertedWithCustomError(placementDrive, "InvalidIpfsHashLength")
        .withArgs(201);
    });

    it("should reject an implausible package", async function () {
      await expect(post(company1, { annualPackage: 0 }))
        .to.be.revertedWithCustomError(placementDrive, "InvalidPackage")
        .withArgs(0);
      await expect(post(company1, { annualPackage: 10n ** 12n + 1n }))
        .to.be.revertedWithCustomError(placementDrive, "InvalidPackage");
    });

    it("should reject a CGPA cutoff above 10.00", async function () {
      await expect(post(company1, { minCgpaScaled: 1001 }))
        .to.be.revertedWithCustomError(placementDrive, "InvalidCgpa")
        .withArgs(1001);
    });

    it("should allow a zero CGPA cutoff, meaning no cutoff", async function () {
      await expect(post(company1, { minCgpaScaled: 0 })).to.not.be.reverted;
      expect((await placementDrive.getDrive(0)).minCgpaScaled).to.equal(0);
    });

    it("should reject an implausible batch year", async function () {
      await expect(post(company1, { batchYear: 1999 }))
        .to.be.revertedWithCustomError(placementDrive, "InvalidBatchYear")
        .withArgs(1999);
      await expect(post(company1, { batchYear: 2101 }))
        .to.be.revertedWithCustomError(placementDrive, "InvalidBatchYear")
        .withArgs(2101);
    });

    it("should reject zero dates, or a deadline after the drive itself", async function () {
      await expect(post(company1, { applicationDeadline: 0 })).to.be.revertedWithCustomError(
        placementDrive,
        "InvalidDriveDates"
      );
      await expect(post(company1, { driveDate: 0 })).to.be.revertedWithCustomError(
        placementDrive,
        "InvalidDriveDates"
      );
      // A deadline that falls after the event it gates is meaningless.
      await expect(
        post(company1, { applicationDeadline: DRIVE_DATE + 1, driveDate: DRIVE_DATE })
      ).to.be.revertedWithCustomError(placementDrive, "InvalidDriveDates");
    });

    it("should allow a deadline on the same day as the drive", async function () {
      await expect(post(company1, { applicationDeadline: DRIVE_DATE, driveDate: DRIVE_DATE })).to
        .not.be.reverted;
    });
  });

  // ===========================================================================
  describe("Approval — only the college it was addressed to", function () {
    beforeEach(async function () {
      await post();
    });

    it("should let the named college approve it", async function () {
      await expect(placementDrive.connect(college1).approveDrive(0))
        .to.emit(placementDrive, "DriveStatusChanged")
        .withArgs(0, DriveStatus.Proposed, DriveStatus.Approved, college1.address);
      expect((await placementDrive.getDrive(0)).status).to.equal(DriveStatus.Approved);
    });

    it("should let the named college reject it", async function () {
      await expect(placementDrive.connect(college1).rejectDrive(0))
        .to.emit(placementDrive, "DriveStatusChanged")
        .withArgs(0, DriveStatus.Proposed, DriveStatus.Rejected, college1.address);
    });

    it("should NOT let a different college approve it", async function () {
      await expect(placementDrive.connect(college2).approveDrive(0))
        .to.be.revertedWithCustomError(placementDrive, "NotAuthorizedForDrive")
        .withArgs(college2.address, 0);
    });

    it("should NOT let the company approve its own drive", async function () {
      // Otherwise the college's consent would be decorative.
      await expect(placementDrive.connect(company1).approveDrive(0))
        .to.be.revertedWithCustomError(placementDrive, "NotAuthorizedForDrive")
        .withArgs(company1.address, 0);
    });

    it("should NOT let the verifier approve a drive", async function () {
      // Hosting is the college's call, not the platform operator's.
      await expect(
        placementDrive.connect(verifier).approveDrive(0)
      ).to.be.revertedWithCustomError(placementDrive, "NotAuthorizedForDrive");
    });

    it("should NOT approve twice", async function () {
      await placementDrive.connect(college1).approveDrive(0);
      await expect(placementDrive.connect(college1).approveDrive(0))
        .to.be.revertedWithCustomError(placementDrive, "WrongDriveStatus")
        .withArgs(0, DriveStatus.Approved);
    });

    it("should NOT reject a drive that was already approved", async function () {
      await placementDrive.connect(college1).approveDrive(0);
      await expect(placementDrive.connect(college1).rejectDrive(0))
        .to.be.revertedWithCustomError(placementDrive, "WrongDriveStatus")
        .withArgs(0, DriveStatus.Approved);
    });

    it("should revert for a drive that doesn't exist", async function () {
      await expect(placementDrive.connect(college1).approveDrive(999))
        .to.be.revertedWithCustomError(placementDrive, "DriveNotFound")
        .withArgs(999);
    });
  });

  // ===========================================================================
  describe("Closing and cancelling", function () {
    beforeEach(async function () {
      await post();
      await placementDrive.connect(college1).approveDrive(0);
    });

    it("should let the company close applications on its own drive", async function () {
      await expect(placementDrive.connect(company1).closeDrive(0))
        .to.emit(placementDrive, "DriveStatusChanged")
        .withArgs(0, DriveStatus.Approved, DriveStatus.Closed, company1.address);
    });

    it("should NOT let the college close applications", async function () {
      await expect(placementDrive.connect(college1).closeDrive(0))
        .to.be.revertedWithCustomError(placementDrive, "NotAuthorizedForDrive")
        .withArgs(college1.address, 0);
    });

    it("should let either party cancel an approved drive", async function () {
      await expect(placementDrive.connect(company1).cancelDrive(0))
        .to.emit(placementDrive, "DriveStatusChanged")
        .withArgs(0, DriveStatus.Approved, DriveStatus.Cancelled, company1.address);
    });

    it("should record which party cancelled", async function () {
      await expect(placementDrive.connect(college1).cancelDrive(0))
        .to.emit(placementDrive, "DriveStatusChanged")
        .withArgs(0, DriveStatus.Approved, DriveStatus.Cancelled, college1.address);
    });

    it("should let a closed drive still be cancelled", async function () {
      await placementDrive.connect(company1).closeDrive(0);
      await expect(placementDrive.connect(company1).cancelDrive(0)).to.not.be.reverted;
    });

    it("should NOT let a stranger cancel", async function () {
      await expect(placementDrive.connect(stranger).cancelDrive(0))
        .to.be.revertedWithCustomError(placementDrive, "NotAuthorizedForDrive")
        .withArgs(stranger.address, 0);
    });

    it("should NOT cancel a drive that was never approved", async function () {
      await post(company2);
      await expect(placementDrive.connect(company2).cancelDrive(1))
        .to.be.revertedWithCustomError(placementDrive, "WrongDriveStatus")
        .withArgs(1, DriveStatus.Proposed);
    });

    it("should keep a cancelled drive visible rather than deleting it", async function () {
      // "This company withdrew" is information a student who applied is
      // entitled to keep.
      await placementDrive.connect(company1).cancelDrive(0);
      const drive = await placementDrive.getDrive(0);
      expect(drive.status).to.equal(DriveStatus.Cancelled);
      expect(drive.roleTitle).to.equal("Software Engineer");
      expect(drive.annualPackage).to.equal(PACKAGE);
    });
  });

  // ===========================================================================
  describe("Application count — the first bar of the public funnel", function () {
    let driveId;
    beforeEach(async function () {
      await post();
      driveId = 0;
      await placementDrive.connect(college1).approveDrive(driveId);
    });

    it("should be unrecorded until the company states it", async function () {
      // A drive nobody applied to and a drive whose count is unpublished both
      // read as zero otherwise, and only one of those is a fact.
      const [count, recorded] = await placementDrive.getApplicationCount(driveId);
      expect(count).to.equal(0);
      expect(recorded).to.be.false;
    });

    it("should let the company state it", async function () {
      await expect(placementDrive.connect(company1).recordApplicationCount(driveId, 140))
        .to.emit(placementDrive, "ApplicationCountRecorded")
        .withArgs(driveId, company1.address, 0, 140);

      const [count, recorded] = await placementDrive.getApplicationCount(driveId);
      expect(count).to.equal(140);
      expect(recorded).to.be.true;
    });

    it("should NOT let the college state it", async function () {
      // The college's conversion rate is what this number shapes, so the college
      // is exactly who must not be able to write it. "12 of 140" and "12 of 20"
      // describe the same event very differently.
      await expect(placementDrive.connect(college1).recordApplicationCount(driveId, 20))
        .to.be.revertedWithCustomError(placementDrive, "NotAuthorizedForDrive")
        .withArgs(college1.address, driveId);
    });

    it("should NOT let another company or a stranger state it", async function () {
      await expect(
        placementDrive.connect(company2).recordApplicationCount(driveId, 20)
      ).to.be.revertedWithCustomError(placementDrive, "NotAuthorizedForDrive");
      await expect(
        placementDrive.connect(stranger).recordApplicationCount(driveId, 20)
      ).to.be.revertedWithCustomError(placementDrive, "NotAuthorizedForDrive");
    });

    it("should expose the previous value when restated", async function () {
      // Correcting a miscount is normal. Doing it invisibly is the problem.
      await placementDrive.connect(company1).recordApplicationCount(driveId, 140);
      await expect(placementDrive.connect(company1).recordApplicationCount(driveId, 138))
        .to.emit(placementDrive, "ApplicationCountRecorded")
        .withArgs(driveId, company1.address, 140, 138);
    });

    it("should accept zero as a real figure", async function () {
      await placementDrive.connect(company1).recordApplicationCount(driveId, 0);
      const [count, recorded] = await placementDrive.getApplicationCount(driveId);
      expect(count).to.equal(0);
      expect(recorded).to.be.true;
    });

    it("should still be recordable after applications close", async function () {
      // The real figure is only known once applications have closed.
      await placementDrive.connect(company1).closeDrive(driveId);
      await expect(placementDrive.connect(company1).recordApplicationCount(driveId, 140)).to.not.be
        .reverted;
    });

    it("should still be recordable after a drive is cancelled", async function () {
      await placementDrive.connect(company1).cancelDrive(driveId);
      await expect(placementDrive.connect(company1).recordApplicationCount(driveId, 140)).to.not.be
        .reverted;
    });

    it("should NOT be recordable before the college agrees to host", async function () {
      await post(company2);
      await expect(placementDrive.connect(company2).recordApplicationCount(1, 140))
        .to.be.revertedWithCustomError(placementDrive, "WrongDriveStatus")
        .withArgs(1, DriveStatus.Proposed);
    });

    it("should NOT be recordable on a rejected drive", async function () {
      await post(company2);
      await placementDrive.connect(college1).rejectDrive(1);
      await expect(placementDrive.connect(company2).recordApplicationCount(1, 140))
        .to.be.revertedWithCustomError(placementDrive, "WrongDriveStatus")
        .withArgs(1, DriveStatus.Rejected);
    });

    it("should reject an implausible count", async function () {
      await expect(placementDrive.connect(company1).recordApplicationCount(driveId, 1000001))
        .to.be.revertedWithCustomError(placementDrive, "InvalidApplicationCount")
        .withArgs(1000001);
    });

    it("should revert for a drive that doesn't exist", async function () {
      await expect(placementDrive.connect(company1).recordApplicationCount(999, 140))
        .to.be.revertedWithCustomError(placementDrive, "DriveNotFound")
        .withArgs(999);
    });

    it("should keep counts separate per drive", async function () {
      await post(company2);
      await placementDrive.connect(college1).approveDrive(1);
      await placementDrive.connect(company1).recordApplicationCount(driveId, 140);
      await placementDrive.connect(company2).recordApplicationCount(1, 37);

      expect((await placementDrive.getApplicationCount(driveId))[0]).to.equal(140);
      expect((await placementDrive.getApplicationCount(1))[0]).to.equal(37);
    });
  });

  // ===========================================================================
  describe("Terms are immutable once posted", function () {
    it("should expose no function that edits a drive's terms", async function () {
      // If a college could revise a package or a cutoff after the fact, every
      // published figure would be its word again rather than the company's.
      const names = placementDrive.interface.fragments
        .filter((f) => f.type === "function")
        .map((f) => f.name);
      // recordApplicationCount is excluded deliberately: it is company-authored
      // and emits its previous value, so it cannot revise anything invisibly.
      // What must never exist is a way to edit another party's terms.
      const mutators = names.filter((n) => /^(edit|update|set|amend|revise)/i.test(n));
      expect(mutators, `unexpected mutators: ${mutators.join(", ")}`).to.have.lengthOf(0);
    });

    it("should keep the original terms through every status change", async function () {
      await post();
      await placementDrive.connect(college1).approveDrive(0);
      await placementDrive.connect(company1).closeDrive(0);
      await placementDrive.connect(college1).cancelDrive(0);

      const drive = await placementDrive.getDrive(0);
      expect(drive.annualPackage).to.equal(PACKAGE);
      expect(drive.minCgpaScaled).to.equal(CGPA);
      expect(drive.batchYear).to.equal(BATCH);
      expect(drive.ipfsHash).to.equal(CID);
      expect(drive.company).to.equal(company1.address);
    });
  });

  // ===========================================================================
  describe("driveAuthority — the view DriveOutcomes depends on", function () {
    it("should report the parties and that an approved drive accepts outcomes", async function () {
      await post();
      await placementDrive.connect(college1).approveDrive(0);
      const [company, college, accepts] = await placementDrive.driveAuthority(0);
      expect(company).to.equal(company1.address);
      expect(college).to.equal(college1.address);
      expect(accepts).to.be.true;
    });

    it("should still accept outcomes after applications close", async function () {
      // Results arrive after the deadline; closing applications must not freeze
      // the process for students already in it.
      await post();
      await placementDrive.connect(college1).approveDrive(0);
      await placementDrive.connect(company1).closeDrive(0);
      const [, , accepts] = await placementDrive.driveAuthority(0);
      expect(accepts).to.be.true;
    });

    it("should refuse outcomes for proposed, rejected or cancelled drives", async function () {
      await post();
      expect((await placementDrive.driveAuthority(0))[2]).to.be.false; // Proposed

      await placementDrive.connect(college1).rejectDrive(0);
      expect((await placementDrive.driveAuthority(0))[2]).to.be.false; // Rejected

      await post(company2);
      await placementDrive.connect(college1).approveDrive(1);
      await placementDrive.connect(company2).cancelDrive(1);
      expect((await placementDrive.driveAuthority(1))[2]).to.be.false; // Cancelled
    });

    it("should report a non-existent drive as having no authority", async function () {
      const [company, college, accepts] = await placementDrive.driveAuthority(999);
      expect(company).to.equal(ZERO_ADDRESS);
      expect(college).to.equal(ZERO_ADDRESS);
      expect(accepts).to.be.false;
    });
  });
});
