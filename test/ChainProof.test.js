const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * ChainProof Test Suite
 * =======================
 * Comprehensive unit tests for ActorRegistry.sol, CredentialIssuer.sol, and
 * PlacementTracker.sol. Tests are organized into describe blocks mirroring the
 * contract architecture.
 *
 * Run: npx hardhat test
 * Run with gas report: REPORT_GAS=true npx hardhat test
 */

describe("ChainProof — Full Test Suite", function () {
  // Shared test state — refreshed before each top-level suite
  let actorRegistry;
  let credentialIssuer;
  let placementTracker;
  let deployer, verifier, student1, student2, college1, college2, company1, company2, stranger;

  // Enum mirrors for readable assertions (must match contract enum order)
  const Role = { None: 0, Student: 1, College: 2, Company: 3 };
  const Status = { None: 0, Pending: 1, Active: 2, Rejected: 3, Suspended: 4 };
  const CredentialType = { General: 0, Shortlist: 1, Interview: 2, Offer: 3, Rejection: 4 };

  // Sample IPFS hashes for test credentials
  const SAMPLE_IPFS_HASH = "QmTestHash1234567890abcdefABCDEF";
  const SAMPLE_IPFS_HASH_2 = "QmAnotherHash0987654321fedcbaFEDCBA";

  const ZERO_ADDRESS = ethers.ZeroAddress;

  // =========================================================================
  // Shared Setup — Deploy fresh contracts before each `it` block
  // =========================================================================
  beforeEach(async function () {
    [deployer, verifier, student1, student2, college1, college2, company1, company2, stranger] =
      await ethers.getSigners();

    // Deploy ActorRegistry with `verifier` as the platform verifier
    const ActorRegistry = await ethers.getContractFactory("ActorRegistry");
    actorRegistry = await ActorRegistry.deploy(verifier.address);

    // Deploy CredentialIssuer with registry address
    const CredentialIssuer = await ethers.getContractFactory("CredentialIssuer");
    credentialIssuer = await CredentialIssuer.deploy(
      await actorRegistry.getAddress()
    );

    // Deploy PlacementTracker with registry address
    const PlacementTracker = await ethers.getContractFactory("PlacementTracker");
    placementTracker = await PlacementTracker.deploy(
      await actorRegistry.getAddress()
    );
  });

  /** Helper: register + approve a College in one step. */
  async function registerActiveCollege(signer, name) {
    await actorRegistry.connect(signer).register(Role.College, name, "", ZERO_ADDRESS);
    await actorRegistry.connect(verifier).approveActor(signer.address);
  }

  /** Helper: register + approve a Company in one step. */
  async function registerActiveCompany(signer, name) {
    await actorRegistry.connect(signer).register(Role.Company, name, "", ZERO_ADDRESS);
    await actorRegistry.connect(verifier).approveActor(signer.address);
  }

  // =========================================================================
  // 1. ActorRegistry Tests
  // =========================================================================
  describe("ActorRegistry", function () {

    describe("Deployment", function () {
      it("should set the deployment-time verifier address", async function () {
        expect(await actorRegistry.verifier()).to.equal(verifier.address);
      });

      it("should revert deployment with a zero verifier address", async function () {
        const ActorRegistry = await ethers.getContractFactory("ActorRegistry");
        await expect(ActorRegistry.deploy(ZERO_ADDRESS)).to.be.revertedWithCustomError(
          ActorRegistry,
          "ZeroAddress"
        );
      });

      it("should return zero totalRegisteredStudents for any college initially", async function () {
        expect(await actorRegistry.totalRegisteredStudents(college1.address)).to.equal(0);
      });

      it("should return Role.None for any unregistered address", async function () {
        expect(await actorRegistry.getActorRole(stranger.address)).to.equal(Role.None);
        expect(await actorRegistry.isRegistered(stranger.address)).to.be.false;
        expect(await actorRegistry.isActive(stranger.address)).to.be.false;
      });
    });

    describe("College / Company Registration — Pending by default", function () {
      it("should register a College as Pending, not Active", async function () {
        await actorRegistry.connect(college1).register(Role.College, "IIT Bombay", "", ZERO_ADDRESS);

        const actor = await actorRegistry.getActor(college1.address);
        expect(actor.role).to.equal(Role.College);
        expect(actor.status).to.equal(Status.Pending);
        expect(await actorRegistry.isActive(college1.address)).to.be.false;
      });

      it("should register a Company as Pending, not Active", async function () {
        await actorRegistry.connect(company1).register(Role.Company, "Infosys Ltd", "", ZERO_ADDRESS);

        const actor = await actorRegistry.getActor(company1.address);
        expect(actor.role).to.equal(Role.Company);
        expect(actor.status).to.equal(Status.Pending);
        expect(await actorRegistry.isActive(company1.address)).to.be.false;
      });

      it("should emit ActorRegistered with initialStatus Pending for a College", async function () {
        await expect(
          actorRegistry.connect(college1).register(Role.College, "IIT Bombay", "", ZERO_ADDRESS)
        )
          .to.emit(actorRegistry, "ActorRegistered")
          .withArgs(college1.address, Role.College, "IIT Bombay", Status.Pending);
      });

      it("should NOT increment any college's totalRegisteredStudents on College/Company registration", async function () {
        await actorRegistry.connect(college1).register(Role.College, "IIT Bombay", "", ZERO_ADDRESS);
        await actorRegistry.connect(company1).register(Role.Company, "Google", "", ZERO_ADDRESS);
        expect(await actorRegistry.totalRegisteredStudents(college1.address)).to.equal(0);
      });
    });

    describe("Verifier — Approve / Reject Workflow", function () {
      beforeEach(async function () {
        await actorRegistry.connect(college1).register(Role.College, "IIT Bombay", "", ZERO_ADDRESS);
        await actorRegistry.connect(company1).register(Role.Company, "Google", "", ZERO_ADDRESS);
      });

      it("should allow the verifier to approve a Pending College", async function () {
        await actorRegistry.connect(verifier).approveActor(college1.address);
        expect(await actorRegistry.isActive(college1.address)).to.be.true;

        const actor = await actorRegistry.getActor(college1.address);
        expect(actor.status).to.equal(Status.Active);
      });

      it("should emit ActorApproved on approval", async function () {
        await expect(actorRegistry.connect(verifier).approveActor(college1.address))
          .to.emit(actorRegistry, "ActorApproved")
          .withArgs(college1.address, verifier.address);
      });

      it("should allow the verifier to reject a Pending Company", async function () {
        await actorRegistry.connect(verifier).rejectActor(company1.address);
        const actor = await actorRegistry.getActor(company1.address);
        expect(actor.status).to.equal(Status.Rejected);
        expect(await actorRegistry.isActive(company1.address)).to.be.false;
      });

      it("should emit ActorRejected on rejection", async function () {
        await expect(actorRegistry.connect(verifier).rejectActor(company1.address))
          .to.emit(actorRegistry, "ActorRejected")
          .withArgs(company1.address, verifier.address);
      });

      it("should not let a stranger approve a College", async function () {
        // Colleges are admitted by the verifier. Companies are admitted by an
        // Active College — see the Company-approval tests below.
        await expect(
          actorRegistry.connect(stranger).approveActor(college1.address)
        )
          .to.be.revertedWithCustomError(actorRegistry, "NotAuthorizedToDecide")
          .withArgs(stranger.address, college1.address);
      });

      it("should not let a stranger reject a College", async function () {
        await expect(
          actorRegistry.connect(deployer).rejectActor(college1.address)
        )
          .to.be.revertedWithCustomError(actorRegistry, "NotAuthorizedToDecide")
          .withArgs(deployer.address, college1.address);
      });

      it("should revert with ActorNotPending when approving an already-Active actor", async function () {
        await actorRegistry.connect(verifier).approveActor(college1.address);
        await expect(
          actorRegistry.connect(verifier).approveActor(college1.address)
        )
          .to.be.revertedWithCustomError(actorRegistry, "ActorNotPending")
          .withArgs(college1.address);
      });

      it("should revert with ActorNotPending when approving an unregistered address", async function () {
        await expect(
          actorRegistry.connect(verifier).approveActor(stranger.address)
        )
          .to.be.revertedWithCustomError(actorRegistry, "ActorNotPending")
          .withArgs(stranger.address);
      });

      it("should revert with ActorNotPending when rejecting an already-Rejected actor", async function () {
        await actorRegistry.connect(verifier).rejectActor(company1.address);
        await expect(
          actorRegistry.connect(verifier).rejectActor(company1.address)
        ).to.be.revertedWithCustomError(actorRegistry, "ActorNotPending");
      });
    });

    describe("Verifier Rotation", function () {
      it("should allow the current verifier to rotate to a new verifier", async function () {
        await expect(actorRegistry.connect(verifier).setVerifier(deployer.address))
          .to.emit(actorRegistry, "VerifierUpdated")
          .withArgs(verifier.address, deployer.address);

        expect(await actorRegistry.verifier()).to.equal(deployer.address);
      });

      it("should revert if a non-verifier attempts to rotate the verifier", async function () {
        await expect(
          actorRegistry.connect(stranger).setVerifier(stranger.address)
        ).to.be.revertedWithCustomError(actorRegistry, "NotVerifier");
      });

      it("should revert if rotating to the zero address", async function () {
        await expect(
          actorRegistry.connect(verifier).setVerifier(ZERO_ADDRESS)
        ).to.be.revertedWithCustomError(actorRegistry, "ZeroAddress");
      });

      it("should require the new verifier's approval after rotation, not the old one", async function () {
        await actorRegistry.connect(verifier).setVerifier(deployer.address);
        await actorRegistry.connect(college1).register(Role.College, "IIT Bombay", "", ZERO_ADDRESS);

        await expect(
          actorRegistry.connect(verifier).approveActor(college1.address)
        ).to.be.revertedWithCustomError(actorRegistry, "NotAuthorizedToDecide");

        await expect(actorRegistry.connect(deployer).approveActor(college1.address)).to.not.be
          .reverted;
      });
    });

    describe("Company Approval — the College is the gate", function () {
      beforeEach(async function () {
        await registerActiveCollege(college1, "IIT Bombay");
        await actorRegistry.connect(company1).register(Role.Company, "Infosys", "", ZERO_ADDRESS);
      });

      it("should let an Active College approve a Company", async function () {
        // A college decides who recruits on its own campus. That is a domain
        // decision, not an administrative one.
        await expect(actorRegistry.connect(college1).approveActor(company1.address))
          .to.emit(actorRegistry, "ActorApproved")
          .withArgs(company1.address, college1.address);
        expect(await actorRegistry.isActive(company1.address)).to.be.true;
      });

      it("should let an Active College reject a Company", async function () {
        await expect(actorRegistry.connect(college1).rejectActor(company1.address))
          .to.emit(actorRegistry, "ActorRejected")
          .withArgs(company1.address, college1.address);
      });

      it("should still let the verifier approve a Company", async function () {
        await expect(actorRegistry.connect(verifier).approveActor(company1.address)).to.not.be
          .reverted;
      });

      it("should NOT let a Pending College approve a Company", async function () {
        await actorRegistry.connect(college2).register(Role.College, "Unapproved Poly", "", ZERO_ADDRESS);
        await expect(actorRegistry.connect(college2).approveActor(company1.address))
          .to.be.revertedWithCustomError(actorRegistry, "NotAuthorizedToDecide")
          .withArgs(college2.address, company1.address);
      });

      it("should NOT let a Company approve another Company", async function () {
        await registerActiveCompany(company2, "Rival Ltd");
        await expect(actorRegistry.connect(company2).approveActor(company1.address))
          .to.be.revertedWithCustomError(actorRegistry, "NotAuthorizedToDecide")
          .withArgs(company2.address, company1.address);
      });

      it("should NOT let a College approve another College", async function () {
        // A college vouching for a peer institution would be unearned authority —
        // that is the verifier's one job.
        await actorRegistry.connect(college2).register(Role.College, "Another Institute", "", ZERO_ADDRESS);
        await expect(actorRegistry.connect(college1).approveActor(college2.address))
          .to.be.revertedWithCustomError(actorRegistry, "NotAuthorizedToDecide")
          .withArgs(college1.address, college2.address);
      });
    });

    describe("Batch Strength — the auditable denominator", function () {
      beforeEach(async function () {
        await registerActiveCollege(college1, "IIT Bombay");
      });

      it("should record a cohort and report it back", async function () {
        await expect(actorRegistry.connect(college1).recordBatchStrength("CSE", 2026, 180))
          .to.emit(actorRegistry, "BatchStrengthRecorded")
          .withArgs(college1.address, "CSE", 2026, 0, 180);

        const batch = await actorRegistry.getBatch(college1.address, "CSE", 2026);
        expect(batch.strength).to.equal(180);
        expect(batch.courseCode).to.equal("CSE");
        expect(batch.exists).to.be.true;
      });

      it("should expose the previous value when a cohort is revised", async function () {
        // The whole point. Restating 180 as 60 is allowed, but it can never look
        // like a first-time declaration — which is how placement rates get
        // inflated without anyone technically lying.
        await actorRegistry.connect(college1).recordBatchStrength("CSE", 2026, 180);
        await expect(actorRegistry.connect(college1).recordBatchStrength("CSE", 2026, 60))
          .to.emit(actorRegistry, "BatchStrengthRecorded")
          .withArgs(college1.address, "CSE", 2026, 180, 60);
      });

      it("should keep cohorts separate by course and by year", async function () {
        await actorRegistry.connect(college1).recordBatchStrength("CSE", 2026, 180);
        await actorRegistry.connect(college1).recordBatchStrength("CSE", 2027, 200);
        await actorRegistry.connect(college1).recordBatchStrength("MECH", 2026, 90);

        expect((await actorRegistry.getBatch(college1.address, "CSE", 2026)).strength).to.equal(180);
        expect((await actorRegistry.getBatch(college1.address, "CSE", 2027)).strength).to.equal(200);
        expect((await actorRegistry.getBatch(college1.address, "MECH", 2026)).strength).to.equal(90);
      });

      it("should report a never-declared cohort as non-existent", async function () {
        const batch = await actorRegistry.getBatch(college1.address, "CIVIL", 2026);
        expect(batch.exists).to.be.false;
        expect(batch.strength).to.equal(0);
      });

      it("should NOT let a Company or a Student declare a cohort", async function () {
        await registerActiveCompany(company1, "Infosys");
        await expect(
          actorRegistry.connect(company1).recordBatchStrength("CSE", 2026, 180)
        ).to.be.revertedWithCustomError(actorRegistry, "Unauthorized");
      });

      it("should NOT let a Pending College declare a cohort", async function () {
        await actorRegistry.connect(college2).register(Role.College, "Unapproved Poly", "", ZERO_ADDRESS);
        await expect(
          actorRegistry.connect(college2).recordBatchStrength("CSE", 2026, 180)
        ).to.be.revertedWithCustomError(actorRegistry, "Unauthorized");
      });

      it("should reject implausible cohort values", async function () {
        await expect(
          actorRegistry.connect(college1).recordBatchStrength("", 2026, 180)
        ).to.be.revertedWithCustomError(actorRegistry, "InvalidCourseCodeLength");

        await expect(
          actorRegistry.connect(college1).recordBatchStrength("C".repeat(21), 2026, 180)
        ).to.be.revertedWithCustomError(actorRegistry, "InvalidCourseCodeLength");

        await expect(
          actorRegistry.connect(college1).recordBatchStrength("CSE", 1999, 180)
        ).to.be.revertedWithCustomError(actorRegistry, "InvalidBatchYear");

        await expect(
          actorRegistry.connect(college1).recordBatchStrength("CSE", 2026, 0)
        ).to.be.revertedWithCustomError(actorRegistry, "InvalidBatchStrength");

        await expect(
          actorRegistry.connect(college1).recordBatchStrength("CSE", 2026, 100001)
        ).to.be.revertedWithCustomError(actorRegistry, "InvalidBatchStrength");
      });
    });

    describe("Student Registration — Requires an Active College", function () {
      it("should revert if the declared college has never registered", async function () {
        await expect(
          actorRegistry.connect(student1).register(Role.Student, "Alice", "", college1.address)
        )
          .to.be.revertedWithCustomError(actorRegistry, "CollegeNotActive")
          .withArgs(college1.address);
      });

      it("should revert if the declared college is still Pending", async function () {
        await actorRegistry.connect(college1).register(Role.College, "IIT Bombay", "", ZERO_ADDRESS);
        await expect(
          actorRegistry.connect(student1).register(Role.Student, "Alice", "", college1.address)
        ).to.be.revertedWithCustomError(actorRegistry, "CollegeNotActive");
      });

      it("should revert if the declared address is a Company, not a College", async function () {
        await registerActiveCompany(company1, "Google");
        await expect(
          actorRegistry.connect(student1).register(Role.Student, "Alice", "", company1.address)
        ).to.be.revertedWithCustomError(actorRegistry, "CollegeNotActive");
      });

      it("should register a Student as Active immediately once their College is Active", async function () {
        await registerActiveCollege(college1, "IIT Bombay");
        await actorRegistry.connect(student1).register(Role.Student, "Alice", "", college1.address);

        const actor = await actorRegistry.getActor(student1.address);
        expect(actor.role).to.equal(Role.Student);
        expect(actor.status).to.equal(Status.Active);
        expect(actor.college).to.equal(college1.address);
        expect(await actorRegistry.isActive(student1.address)).to.be.true;
      });

      it("should increment the declared college's totalRegisteredStudents", async function () {
        await registerActiveCollege(college1, "IIT Bombay");
        await actorRegistry.connect(student1).register(Role.Student, "Alice", "", college1.address);
        expect(await actorRegistry.totalRegisteredStudents(college1.address)).to.equal(1);

        await actorRegistry.connect(student2).register(Role.Student, "Bob", "", college1.address);
        expect(await actorRegistry.totalRegisteredStudents(college1.address)).to.equal(2);
      });

      it("should keep per-college student counts isolated", async function () {
        await registerActiveCollege(college1, "IIT Bombay");
        await registerActiveCollege(college2, "IIT Delhi");

        await actorRegistry.connect(student1).register(Role.Student, "Alice", "", college1.address);
        await actorRegistry.connect(student2).register(Role.Student, "Bob", "", college2.address);

        expect(await actorRegistry.totalRegisteredStudents(college1.address)).to.equal(1);
        expect(await actorRegistry.totalRegisteredStudents(college2.address)).to.equal(1);
      });

      it("should record the correct declared college via getStudentCollege", async function () {
        await registerActiveCollege(college1, "IIT Bombay");
        await actorRegistry.connect(student1).register(Role.Student, "Alice", "", college1.address);
        expect(await actorRegistry.getStudentCollege(student1.address)).to.equal(college1.address);
      });
    });

    describe("Double-Registration Prevention", function () {
      it("should revert with AlreadyRegistered if address registers twice", async function () {
        await registerActiveCollege(college1, "IIT Bombay");
        await actorRegistry.connect(student1).register(Role.Student, "Alice", "", college1.address);

        await expect(
          actorRegistry.connect(student1).register(Role.College, "Hacker College", "", ZERO_ADDRESS)
        )
          .to.be.revertedWithCustomError(actorRegistry, "AlreadyRegistered")
          .withArgs(student1.address);
      });

      it("should revert even if the same role is attempted again", async function () {
        await actorRegistry.connect(college1).register(Role.College, "IIT", "", ZERO_ADDRESS);
        await expect(
          actorRegistry.connect(college1).register(Role.College, "IIT Duplicate", "", ZERO_ADDRESS)
        ).to.be.revertedWithCustomError(actorRegistry, "AlreadyRegistered");
      });

      it("should allow resubmission after rejection, not block it", async function () {
        // A rejection is a "try again", not a permanent ban — see the
        // "Resubmission After Rejection" suite below for the full behavior.
        await actorRegistry.connect(company1).register(Role.Company, "Google", "", ZERO_ADDRESS);
        await actorRegistry.connect(verifier).rejectActor(company1.address);

        await expect(
          actorRegistry.connect(company1).register(Role.Company, "Google Retry", "", ZERO_ADDRESS)
        ).to.not.be.reverted;
      });
    });

    describe("Invalid Role Prevention", function () {
      it("should revert with InvalidRole if Role.None (0) is passed", async function () {
        await expect(
          actorRegistry.connect(stranger).register(Role.None, "Invalid Actor", "", ZERO_ADDRESS)
        )
          .to.be.revertedWithCustomError(actorRegistry, "InvalidRole")
          .withArgs(0);
      });
    });

    describe("On-Chain Input Bounds", function () {
      // The backend enforces these same limits, but anyone can call the
      // contract directly on a public chain — so these tests exist to prove
      // the guarantee holds without the backend in front of it.
      it("should revert with InvalidNameLength for an empty name", async function () {
        await expect(
          actorRegistry.connect(stranger).register(Role.Company, "", "", ZERO_ADDRESS)
        )
          .to.be.revertedWithCustomError(actorRegistry, "InvalidNameLength")
          .withArgs(0);
      });

      it("should revert with InvalidNameLength for a name over MAX_NAME_LENGTH", async function () {
        const tooLong = "A".repeat(101);
        await expect(
          actorRegistry.connect(stranger).register(Role.Company, tooLong, "", ZERO_ADDRESS)
        )
          .to.be.revertedWithCustomError(actorRegistry, "InvalidNameLength")
          .withArgs(101);
      });

      it("should accept a name exactly at MAX_NAME_LENGTH", async function () {
        const exact = "A".repeat(100);
        await actorRegistry.connect(stranger).register(Role.Company, exact, "", ZERO_ADDRESS);
        const actor = await actorRegistry.getActor(stranger.address);
        expect(actor.name).to.equal(exact);
      });

      it("should measure the name in bytes, not characters (multi-byte scripts)", async function () {
        // 40 Devanagari characters = 120 UTF-8 bytes, so this is over the
        // limit even though it's well under 100 "characters" — the backend
        // measures byte length for exactly this reason.
        const devanagari = "अ".repeat(40);
        await expect(
          actorRegistry.connect(stranger).register(Role.Company, devanagari, "", ZERO_ADDRESS)
        )
          .to.be.revertedWithCustomError(actorRegistry, "InvalidNameLength")
          .withArgs(120);
      });

      it("should revert with MetadataTooLong for metadata over MAX_METADATA_LENGTH", async function () {
        const tooLong = "x".repeat(201);
        await expect(
          actorRegistry.connect(stranger).register(Role.Company, "Valid Name", tooLong, ZERO_ADDRESS)
        )
          .to.be.revertedWithCustomError(actorRegistry, "MetadataTooLong")
          .withArgs(201);
      });

      it("should expose the bounds as public constants", async function () {
        expect(await actorRegistry.MAX_NAME_LENGTH()).to.equal(100);
        expect(await actorRegistry.MAX_METADATA_LENGTH()).to.equal(200);
      });
    });

    describe("Resubmission After Rejection", function () {
      it("should let a rejected Company resubmit and re-enter Pending", async function () {
        await actorRegistry.connect(company1).register(Role.Company, "Google", "", ZERO_ADDRESS);
        await actorRegistry.connect(verifier).rejectActor(company1.address);

        await actorRegistry.connect(company1).register(Role.Company, "Google Retry", "", ZERO_ADDRESS);

        const actor = await actorRegistry.getActor(company1.address);
        expect(actor.status).to.equal(Status.Pending);
        expect(actor.name).to.equal("Google Retry");
      });

      it("should carry the rejectionCount forward across a resubmission", async function () {
        await actorRegistry.connect(college1).register(Role.College, "IIT", "", ZERO_ADDRESS);
        await actorRegistry.connect(verifier).rejectActor(college1.address);

        let actor = await actorRegistry.getActor(college1.address);
        expect(actor.rejectionCount).to.equal(1);

        await actorRegistry.connect(college1).register(Role.College, "IIT Retry", "", ZERO_ADDRESS);
        actor = await actorRegistry.getActor(college1.address);
        expect(actor.rejectionCount).to.equal(1); // preserved, not reset

        await actorRegistry.connect(verifier).rejectActor(college1.address);
        actor = await actorRegistry.getActor(college1.address);
        expect(actor.rejectionCount).to.equal(2); // increments again
      });

      it("should allow a resubmission to pick a different role", async function () {
        await actorRegistry.connect(company1).register(Role.College, "Wrong Role College", "", ZERO_ADDRESS);
        await actorRegistry.connect(verifier).rejectActor(company1.address);

        await actorRegistry.connect(company1).register(Role.Company, "Actually A Company", "", ZERO_ADDRESS);
        const actor = await actorRegistry.getActor(company1.address);
        expect(actor.role).to.equal(Role.Company);
        expect(actor.rejectionCount).to.equal(1);
      });

      it("should still block re-registration for a Pending actor", async function () {
        await actorRegistry.connect(company1).register(Role.Company, "Google", "", ZERO_ADDRESS);
        await expect(
          actorRegistry.connect(company1).register(Role.Company, "Google Again", "", ZERO_ADDRESS)
        ).to.be.revertedWithCustomError(actorRegistry, "AlreadyRegistered");
      });

      it("should still block re-registration for an Active actor", async function () {
        await registerActiveCompany(company1, "Google");
        await expect(
          actorRegistry.connect(company1).register(Role.Company, "Google Again", "", ZERO_ADDRESS)
        ).to.be.revertedWithCustomError(actorRegistry, "AlreadyRegistered");
      });

      it("should allow a resubmitted-then-reapproved actor to be rejected again later", async function () {
        await actorRegistry.connect(company1).register(Role.Company, "Google", "", ZERO_ADDRESS);
        await actorRegistry.connect(verifier).rejectActor(company1.address);
        await actorRegistry.connect(company1).register(Role.Company, "Google Retry", "", ZERO_ADDRESS);
        await actorRegistry.connect(verifier).approveActor(company1.address);

        expect(await actorRegistry.isActive(company1.address)).to.be.true;
        const actor = await actorRegistry.getActor(company1.address);
        expect(actor.rejectionCount).to.equal(1); // one rejection in its history, now Active
      });
    });

    // =====================================================================
    // Suspension - the admin's only power over an account
    // =====================================================================
    describe("Suspension and Reinstatement", function () {
      /**
       * The platform owner needs an answer to a fake company, or a shared login
       * that has to stop acting today. "Edit the database" is not one, because
       * an admin who can edit records makes every record it touches worthless.
       * Suspension is that answer: it stops an account acting without touching
       * a single thing the account already signed.
       */

      it("should suspend an Active college, blocking it from acting", async function () {
        await registerActiveCollege(college1, "IIT Bombay");

        await expect(actorRegistry.connect(verifier).suspendActor(college1.address, "under review"))
          .to.emit(actorRegistry, "ActorSuspended")
          .withArgs(college1.address, verifier.address, "under review");

        expect(await actorRegistry.isActive(college1.address)).to.be.false;
        const actor = await actorRegistry.getActor(college1.address);
        expect(actor.status).to.equal(Status.Suspended);
      });

      it("should keep the suspended actor's name and history intact", async function () {
        // Suspension withdraws access; it does not rewrite the past. If it did,
        // an admin could erase an inconvenient record by suspending its author.
        await registerActiveCollege(college1, "IIT Bombay");
        await actorRegistry.connect(college1).recordBatchStrength("CSE", 2026, 180);

        await actorRegistry.connect(verifier).suspendActor(college1.address, "under review");

        const actor = await actorRegistry.getActor(college1.address);
        expect(actor.name).to.equal("IIT Bombay");
        expect(actor.role).to.equal(Role.College);
        const batch = await actorRegistry.getBatch(college1.address, "CSE", 2026);
        expect(batch.strength).to.equal(180);
      });

      it("should restore a suspended actor on reinstatement", async function () {
        await registerActiveCollege(college1, "IIT Bombay");
        await actorRegistry.connect(verifier).suspendActor(college1.address, "under review");

        await expect(actorRegistry.connect(verifier).reinstateActor(college1.address))
          .to.emit(actorRegistry, "ActorReinstated")
          .withArgs(college1.address, verifier.address);

        expect(await actorRegistry.isActive(college1.address)).to.be.true;
      });

      it("should let a College suspend a Company recruiting on its campus", async function () {
        // Same split as approval: a college decides who recruits at it.
        await registerActiveCollege(college1, "IIT Bombay");
        await actorRegistry.connect(company1).register(Role.Company, "Shell Corp", "", ZERO_ADDRESS);
        await actorRegistry.connect(college1).approveActor(company1.address);

        await actorRegistry.connect(college1).suspendActor(company1.address, "not a real recruiter");
        expect(await actorRegistry.isActive(company1.address)).to.be.false;

        await actorRegistry.connect(college1).reinstateActor(company1.address);
        expect(await actorRegistry.isActive(company1.address)).to.be.true;
      });

      it("should not let a College suspend another College", async function () {
        await registerActiveCollege(college1, "IIT Bombay");
        await registerActiveCollege(college2, "Rival Institute");

        await expect(
          actorRegistry.connect(college1).suspendActor(college2.address, "competitor")
        ).to.be.revertedWithCustomError(actorRegistry, "NotAuthorizedToDecide");
      });

      it("should not let a Company suspend anyone", async function () {
        await registerActiveCollege(college1, "IIT Bombay");
        await actorRegistry.connect(company1).register(Role.Company, "Infosys", "", ZERO_ADDRESS);
        await actorRegistry.connect(college1).approveActor(company1.address);
        await actorRegistry.connect(student1).register(Role.Student, "A Student", "", college1.address);

        await expect(
          actorRegistry.connect(company1).suspendActor(student1.address, "declined our offer")
        ).to.be.revertedWithCustomError(actorRegistry, "NotAuthorizedToDecide");
      });

      it("should not let a stranger suspend anyone", async function () {
        await registerActiveCollege(college1, "IIT Bombay");
        await expect(
          actorRegistry.connect(stranger).suspendActor(college1.address, "because")
        ).to.be.revertedWithCustomError(actorRegistry, "NotAuthorizedToDecide");
      });

      it("should refuse to suspend an actor that is not Active", async function () {
        await actorRegistry.connect(college1).register(Role.College, "Pending Institute", "", ZERO_ADDRESS);
        await expect(
          actorRegistry.connect(verifier).suspendActor(college1.address, "too early")
        ).to.be.revertedWithCustomError(actorRegistry, "ActorNotActive");
      });

      it("should refuse to suspend the same actor twice", async function () {
        await registerActiveCollege(college1, "IIT Bombay");
        await actorRegistry.connect(verifier).suspendActor(college1.address, "once");
        await expect(
          actorRegistry.connect(verifier).suspendActor(college1.address, "again")
        ).to.be.revertedWithCustomError(actorRegistry, "ActorNotActive");
      });

      it("should refuse to reinstate an actor that was never suspended", async function () {
        await registerActiveCollege(college1, "IIT Bombay");
        await expect(
          actorRegistry.connect(verifier).reinstateActor(college1.address)
        ).to.be.revertedWithCustomError(actorRegistry, "ActorNotSuspended");
      });

      it("should refuse a suspension reason longer than the bound", async function () {
        await registerActiveCollege(college1, "IIT Bombay");
        await expect(
          actorRegistry.connect(verifier).suspendActor(college1.address, "x".repeat(201))
        ).to.be.revertedWithCustomError(actorRegistry, "ReasonTooLong");
      });

      it("should accept an empty reason without pretending one was given", async function () {
        // Better an empty string on the record than a forced placeholder that
        // reads like a justification nobody actually wrote.
        await registerActiveCollege(college1, "IIT Bombay");
        await expect(actorRegistry.connect(verifier).suspendActor(college1.address, ""))
          .to.emit(actorRegistry, "ActorSuspended")
          .withArgs(college1.address, verifier.address, "");
      });

      it("should not let a suspended address register again to escape the suspension", async function () {
        // Only a Rejected address may resubmit. If Suspended could too, the
        // suspension would last exactly as long as it took to notice it.
        await registerActiveCollege(college1, "IIT Bombay");
        await actorRegistry.connect(verifier).suspendActor(college1.address, "under review");

        await expect(
          actorRegistry.connect(college1).register(Role.College, "IIT Bombay Again", "", ZERO_ADDRESS)
        ).to.be.revertedWithCustomError(actorRegistry, "AlreadyRegistered");
      });

      it("should stop a suspended college declaring a batch strength", async function () {
        await registerActiveCollege(college1, "IIT Bombay");
        await actorRegistry.connect(verifier).suspendActor(college1.address, "under review");

        await expect(
          actorRegistry.connect(college1).recordBatchStrength("CSE", 2026, 60)
        ).to.be.reverted;
      });

      it("should stop a student registering under a suspended college", async function () {
        await registerActiveCollege(college1, "IIT Bombay");
        await actorRegistry.connect(verifier).suspendActor(college1.address, "under review");

        await expect(
          actorRegistry.connect(student1).register(Role.Student, "A Student", "", college1.address)
        ).to.be.revertedWithCustomError(actorRegistry, "CollegeNotActive");
      });
    });
  });

  // =========================================================================
  // 2. CredentialIssuer Tests
  // =========================================================================
  describe("CredentialIssuer", function () {

    // Setup registered + verified actors for credential tests
    beforeEach(async function () {
      await actorRegistry.connect(college1).register(Role.College, "IIT Bombay", "", ZERO_ADDRESS);
      await actorRegistry.connect(verifier).approveActor(college1.address);

      await actorRegistry.connect(student1).register(Role.Student, "Alice", "", college1.address);
      await actorRegistry.connect(student2).register(Role.Student, "Bob", "", college1.address);

      await actorRegistry.connect(company1).register(Role.Company, "Google", "", ZERO_ADDRESS);
      await actorRegistry.connect(verifier).approveActor(company1.address);
    });

    describe("Deployment", function () {
      it("should store the correct registry address", async function () {
        expect(await credentialIssuer.actorRegistry()).to.equal(
          await actorRegistry.getAddress()
        );
      });

      it("should start with zero totalPlacedStudents and nextCredentialId", async function () {
        expect(await credentialIssuer.totalPlacedStudents(college1.address)).to.equal(0);
        expect(await credentialIssuer.nextCredentialId()).to.equal(0);
      });

      it("should revert if deployed with a zero registry address", async function () {
        const CredentialIssuer = await ethers.getContractFactory("CredentialIssuer");
        await expect(
          CredentialIssuer.deploy(ZERO_ADDRESS)
        ).to.be.revertedWithCustomError(CredentialIssuer, "InvalidRegistryAddress");
      });
    });

    describe("Credential Issuance — On-Chain Input Bounds", function () {
      it("should revert with InvalidIpfsHashLength for an empty hash", async function () {
        await expect(
          credentialIssuer.connect(college1).issueCredential(student1.address, "", CredentialType.General)
        )
          .to.be.revertedWithCustomError(credentialIssuer, "InvalidIpfsHashLength")
          .withArgs(0);
      });

      it("should revert with InvalidIpfsHashLength for a hash over the cap", async function () {
        await expect(
          credentialIssuer
            .connect(college1)
            .issueCredential(student1.address, "Q".repeat(201), CredentialType.General)
        )
          .to.be.revertedWithCustomError(credentialIssuer, "InvalidIpfsHashLength")
          .withArgs(201);
      });

      it("should enforce the same hash bound on issueCorrection", async function () {
        // Issued by a Company: only a Company may create an Offer (see
        // _checkMayIssueOfferType), so a College signer here would revert for
        // that reason instead of the hash bound this test is about.
        await credentialIssuer
          .connect(company1)
          .issueCredential(student1.address, SAMPLE_IPFS_HASH, CredentialType.Offer);

        await expect(
          credentialIssuer.connect(company1).issueCorrection(student1.address, 0, "", CredentialType.Rejection)
        )
          .to.be.revertedWithCustomError(credentialIssuer, "InvalidIpfsHashLength")
          .withArgs(0);
      });
    });

    describe("Credential Issuance — Authorization", function () {
      it("should allow an Active College to issue a General credential", async function () {
        await expect(
          credentialIssuer
            .connect(college1)
            .issueCredential(student1.address, SAMPLE_IPFS_HASH, CredentialType.General)
        ).to.not.be.reverted;
      });

      it("should NOT let a College issue an Offer", async function () {
        // An Offer is the record that marks a student placed, and placement
        // percentages are what Colleges are held accountable for here. A
        // College issuing its own Offers is the self-reported statistic this
        // project exists to replace.
        await expect(
          credentialIssuer
            .connect(college1)
            .issueCredential(student1.address, SAMPLE_IPFS_HASH, CredentialType.Offer)
        )
          .to.be.revertedWithCustomError(credentialIssuer, "OnlyCompanyCanIssueOffer")
          .withArgs(college1.address);
      });

      it("should NOT let a College correct a credential into an Offer", async function () {
        // The correction path would otherwise be a way around the rule above.
        await credentialIssuer
          .connect(college1)
          .issueCredential(student1.address, SAMPLE_IPFS_HASH, CredentialType.Shortlist);

        await expect(
          credentialIssuer
            .connect(college1)
            .issueCorrection(student1.address, 0, SAMPLE_IPFS_HASH_2, CredentialType.Offer)
        )
          .to.be.revertedWithCustomError(credentialIssuer, "OnlyCompanyCanIssueOffer")
          .withArgs(college1.address);
      });

      it("should leave a College free to issue every other credential type", async function () {
        for (const type of [
          CredentialType.General,
          CredentialType.Shortlist,
          CredentialType.Interview,
          CredentialType.Rejection,
        ]) {
          await expect(
            credentialIssuer
              .connect(college1)
              .issueCredential(student1.address, SAMPLE_IPFS_HASH, type)
          ).to.not.be.reverted;
        }
        // And none of them marks the student placed.
        expect(await credentialIssuer.isPlaced(student1.address)).to.be.false;
      });

      it("should still allow a Company to issue an Offer, placing the student", async function () {
        await credentialIssuer
          .connect(company1)
          .issueCredential(student1.address, SAMPLE_IPFS_HASH, CredentialType.Offer);
        expect(await credentialIssuer.isPlaced(student1.address)).to.be.true;
      });

      it("should allow an Active Company to issue a Shortlist credential", async function () {
        await expect(
          credentialIssuer
            .connect(company1)
            .issueCredential(student1.address, SAMPLE_IPFS_HASH, CredentialType.Shortlist)
        ).to.not.be.reverted;
      });

      it("should revert with NotAuthorizedIssuer when a still-Pending College tries to issue", async function () {
        await actorRegistry.connect(college2).register(Role.College, "IIT Delhi", "", ZERO_ADDRESS);
        await expect(
          credentialIssuer
            .connect(college2)
            .issueCredential(student1.address, SAMPLE_IPFS_HASH, CredentialType.General)
        )
          .to.be.revertedWithCustomError(credentialIssuer, "NotAuthorizedIssuer")
          .withArgs(college2.address);
      });

      it("should revert with NotAuthorizedIssuer when a Rejected Company tries to issue", async function () {
        await actorRegistry.connect(company2).register(Role.Company, "Microsoft", "", ZERO_ADDRESS);
        await actorRegistry.connect(verifier).rejectActor(company2.address);

        await expect(
          credentialIssuer
            .connect(company2)
            .issueCredential(student1.address, SAMPLE_IPFS_HASH, CredentialType.General)
        )
          .to.be.revertedWithCustomError(credentialIssuer, "NotAuthorizedIssuer")
          .withArgs(company2.address);
      });

      it("should revert with NotAuthorizedIssuer when a Student tries to issue", async function () {
        await expect(
          credentialIssuer
            .connect(student1)
            .issueCredential(student2.address, SAMPLE_IPFS_HASH, CredentialType.General)
        )
          .to.be.revertedWithCustomError(credentialIssuer, "NotAuthorizedIssuer")
          .withArgs(student1.address);
      });

      it("should revert with NotAuthorizedIssuer for unregistered callers", async function () {
        await expect(
          credentialIssuer
            .connect(stranger)
            .issueCredential(student1.address, SAMPLE_IPFS_HASH, CredentialType.General)
        )
          .to.be.revertedWithCustomError(credentialIssuer, "NotAuthorizedIssuer")
          .withArgs(stranger.address);
      });

      it("should revert with RecipientNotStudent when issuing to a College", async function () {
        await expect(
          credentialIssuer
            .connect(company1)
            .issueCredential(college1.address, SAMPLE_IPFS_HASH, CredentialType.General)
        )
          .to.be.revertedWithCustomError(credentialIssuer, "RecipientNotStudent")
          .withArgs(college1.address);
      });

      it("should revert with RecipientNotStudent when issuing to an unregistered address", async function () {
        await expect(
          credentialIssuer
            .connect(company1)
            .issueCredential(stranger.address, SAMPLE_IPFS_HASH, CredentialType.General)
        )
          .to.be.revertedWithCustomError(credentialIssuer, "RecipientNotStudent")
          .withArgs(stranger.address);
      });
    });

    describe("Credential Data & Events", function () {
      it("should emit CredentialIssued event with correct parameters", async function () {
        const tx = await credentialIssuer
          .connect(company1)
          .issueCredential(student1.address, SAMPLE_IPFS_HASH, CredentialType.Interview);

        const receipt = await tx.wait();
        const block = await ethers.provider.getBlock(receipt.blockNumber);

        await expect(tx)
          .to.emit(credentialIssuer, "CredentialIssued")
          .withArgs(
            student1.address,
            company1.address,
            0, // first credential ID
            SAMPLE_IPFS_HASH,
            CredentialType.Interview,
            block.timestamp,
            false, // isCorrection
            0 // supersedesId (unused when isCorrection is false)
          );
      });

      it("should auto-increment credential IDs across multiple issuances", async function () {
        await credentialIssuer
          .connect(company1)
          .issueCredential(student1.address, SAMPLE_IPFS_HASH, CredentialType.Shortlist);
        await credentialIssuer
          .connect(company1)
          .issueCredential(student1.address, SAMPLE_IPFS_HASH_2, CredentialType.Interview);

        const credentials = await credentialIssuer.getStudentCredentials(student1.address);
        expect(credentials[0].id).to.equal(0);
        expect(credentials[1].id).to.equal(1);
        expect(await credentialIssuer.nextCredentialId()).to.equal(2);
      });

      it("should store credential data correctly", async function () {
        await credentialIssuer
          .connect(college1)
          .issueCredential(student1.address, SAMPLE_IPFS_HASH, CredentialType.General);

        const credentials = await credentialIssuer.getStudentCredentials(student1.address);
        expect(credentials.length).to.equal(1);
        expect(credentials[0].ipfsHash).to.equal(SAMPLE_IPFS_HASH);
        expect(credentials[0].issuer).to.equal(college1.address);
        expect(credentials[0].credType).to.equal(CredentialType.General);
      });
    });

    describe("Placement Metrics — The Truth Layer (Per-College)", function () {
      it("should mark a student as placed when an Offer credential is issued", async function () {
        expect(await credentialIssuer.isPlaced(student1.address)).to.be.false;

        await credentialIssuer
          .connect(company1)
          .issueCredential(student1.address, SAMPLE_IPFS_HASH, CredentialType.Offer);

        expect(await credentialIssuer.isPlaced(student1.address)).to.be.true;
        expect(await credentialIssuer.totalPlacedStudents(college1.address)).to.equal(1);
      });

      it("should NOT double-count a student who receives multiple Offer credentials", async function () {
        // First offer — places the student
        await credentialIssuer
          .connect(company1)
          .issueCredential(student1.address, SAMPLE_IPFS_HASH, CredentialType.Offer);

        // Second offer from a different company — student already placed
        await actorRegistry.connect(company2).register(Role.Company, "Microsoft", "", ZERO_ADDRESS);
        await actorRegistry.connect(verifier).approveActor(company2.address);
        await credentialIssuer
          .connect(company2)
          .issueCredential(student1.address, SAMPLE_IPFS_HASH_2, CredentialType.Offer);

        // Counter must still be 1
        expect(await credentialIssuer.totalPlacedStudents(college1.address)).to.equal(1);
      });

      it("should NOT increment placed counter for non-Offer credentials", async function () {
        await credentialIssuer
          .connect(company1)
          .issueCredential(student1.address, SAMPLE_IPFS_HASH, CredentialType.Shortlist);
        await credentialIssuer
          .connect(company1)
          .issueCredential(student1.address, SAMPLE_IPFS_HASH, CredentialType.Interview);
        await credentialIssuer
          .connect(company1)
          .issueCredential(student1.address, SAMPLE_IPFS_HASH, CredentialType.Rejection);

        expect(await credentialIssuer.totalPlacedStudents(college1.address)).to.equal(0);
        expect(await credentialIssuer.isPlaced(student1.address)).to.be.false;
      });

      it("should emit StudentPlaced event with the student's college when first marked placed", async function () {
        await expect(
          credentialIssuer
            .connect(company1)
            .issueCredential(student1.address, SAMPLE_IPFS_HASH, CredentialType.Offer)
        )
          .to.emit(credentialIssuer, "StudentPlaced")
          .withArgs(student1.address, college1.address, 1, 2, true); // 2 students registered under college1 in beforeEach
      });

      it("should correctly calculate placement percentage via getPlacementPercentage(college)", async function () {
        // 2 students registered under college1; 0 placed -> 0%
        expect(await credentialIssuer.getPlacementPercentage(college1.address)).to.equal(0);

        // Place student1 -> 1/2 = 50% -> scaled: 5000
        await credentialIssuer
          .connect(company1)
          .issueCredential(student1.address, SAMPLE_IPFS_HASH, CredentialType.Offer);
        expect(await credentialIssuer.getPlacementPercentage(college1.address)).to.equal(5000);

        // Place student2 -> 2/2 = 100% -> scaled: 10000
        await credentialIssuer
          .connect(company1)
          .issueCredential(student2.address, SAMPLE_IPFS_HASH, CredentialType.Offer);
        expect(await credentialIssuer.getPlacementPercentage(college1.address)).to.equal(10000);
      });

      it("should keep placement percentages isolated between colleges", async function () {
        // Second college with its own student
        await actorRegistry.connect(college2).register(Role.College, "IIT Delhi", "", ZERO_ADDRESS);
        await actorRegistry.connect(verifier).approveActor(college2.address);

        const [, , , , , , , , , student3] = await ethers.getSigners();
        await actorRegistry.connect(student3).register(Role.Student, "Carol", "", college2.address);

        // Place the college2 student only
        await credentialIssuer
          .connect(company1)
          .issueCredential(student3.address, SAMPLE_IPFS_HASH, CredentialType.Offer);

        // college2: 1/1 = 100%; college1: 0/2 = 0% (unaffected)
        expect(await credentialIssuer.getPlacementPercentage(college2.address)).to.equal(10000);
        expect(await credentialIssuer.getPlacementPercentage(college1.address)).to.equal(0);
      });

      it("should return 0 for placement percentage when a college has no registered students", async function () {
        expect(await credentialIssuer.getPlacementPercentage(stranger.address)).to.equal(0);
      });
    });

    describe("Student Credential History", function () {
      it("should correctly track credential count for a student", async function () {
        expect(
          await credentialIssuer.getStudentCredentialCount(student1.address)
        ).to.equal(0);

        await credentialIssuer
          .connect(company1)
          .issueCredential(student1.address, SAMPLE_IPFS_HASH, CredentialType.Shortlist);
        await credentialIssuer
          .connect(company1)
          .issueCredential(student1.address, SAMPLE_IPFS_HASH_2, CredentialType.Interview);

        expect(
          await credentialIssuer.getStudentCredentialCount(student1.address)
        ).to.equal(2);
      });

      it("should isolate credentials between different students", async function () {
        await credentialIssuer
          .connect(company1)
          .issueCredential(student1.address, SAMPLE_IPFS_HASH, CredentialType.Offer);

        const s1Creds = await credentialIssuer.getStudentCredentials(student1.address);
        const s2Creds = await credentialIssuer.getStudentCredentials(student2.address);

        expect(s1Creds.length).to.equal(1);
        expect(s2Creds.length).to.equal(0);
      });
    });

    describe("Credential Corrections — Append-Only", function () {
      it("should rescind a student's only Offer, un-placing them", async function () {
        const issueTx = await credentialIssuer
          .connect(company1)
          .issueCredential(student1.address, SAMPLE_IPFS_HASH, CredentialType.Offer);
        await issueTx.wait();
        expect(await credentialIssuer.isPlaced(student1.address)).to.be.true;
        expect(await credentialIssuer.totalPlacedStudents(college1.address)).to.equal(1);

        await expect(
          credentialIssuer
            .connect(company1)
            .issueCorrection(student1.address, 0, SAMPLE_IPFS_HASH_2, CredentialType.Rejection)
        )
          .to.emit(credentialIssuer, "StudentPlaced")
          .withArgs(student1.address, college1.address, 0, 2, false);

        expect(await credentialIssuer.isPlaced(student1.address)).to.be.false;
        expect(await credentialIssuer.totalPlacedStudents(college1.address)).to.equal(0);
      });

      it("should mark the original credential as superseded and record the correction linked to it", async function () {
        await credentialIssuer
          .connect(company1)
          .issueCredential(student1.address, SAMPLE_IPFS_HASH, CredentialType.Offer);
        await credentialIssuer
          .connect(company1)
          .issueCorrection(student1.address, 0, SAMPLE_IPFS_HASH_2, CredentialType.Rejection);

        const creds = await credentialIssuer.getStudentCredentials(student1.address);
        expect(creds.length).to.equal(2);
        expect(creds[0].superseded).to.be.true;
        expect(creds[1].isCorrection).to.be.true;
        expect(creds[1].supersedesId).to.equal(0);
        expect(creds[1].credType).to.equal(CredentialType.Rejection);
      });

      it("should place a student when correcting a Rejection into an Offer", async function () {
        await credentialIssuer
          .connect(company1)
          .issueCredential(student1.address, SAMPLE_IPFS_HASH, CredentialType.Rejection);
        expect(await credentialIssuer.isPlaced(student1.address)).to.be.false;

        await expect(
          credentialIssuer
            .connect(company1)
            .issueCorrection(student1.address, 0, SAMPLE_IPFS_HASH_2, CredentialType.Offer)
        )
          .to.emit(credentialIssuer, "StudentPlaced")
          .withArgs(student1.address, college1.address, 1, 2, true);

        expect(await credentialIssuer.isPlaced(student1.address)).to.be.true;
        expect(await credentialIssuer.totalPlacedStudents(college1.address)).to.equal(1);
      });

      it("should NOT un-place a student who still holds another active Offer", async function () {
        await actorRegistry.connect(company2).register(Role.Company, "Microsoft", "", ZERO_ADDRESS);
        await actorRegistry.connect(verifier).approveActor(company2.address);

        // Two offers from two different companies
        await credentialIssuer
          .connect(company1)
          .issueCredential(student1.address, SAMPLE_IPFS_HASH, CredentialType.Offer); // id 0
        await credentialIssuer
          .connect(company2)
          .issueCredential(student1.address, SAMPLE_IPFS_HASH_2, CredentialType.Offer); // id 1

        expect(await credentialIssuer.totalPlacedStudents(college1.address)).to.equal(1);

        // Rescind only company1's offer — company2's still stands
        await credentialIssuer
          .connect(company1)
          .issueCorrection(student1.address, 0, SAMPLE_IPFS_HASH, CredentialType.Rejection);

        expect(await credentialIssuer.isPlaced(student1.address)).to.be.true;
        expect(await credentialIssuer.totalPlacedStudents(college1.address)).to.equal(1);
      });

      it("should revert with CredentialNotFound for a bad original id", async function () {
        await expect(
          credentialIssuer
            .connect(company1)
            .issueCorrection(student1.address, 999, SAMPLE_IPFS_HASH, CredentialType.Rejection)
        )
          .to.be.revertedWithCustomError(credentialIssuer, "CredentialNotFound")
          .withArgs(student1.address, 999);
      });

      it("should revert with NotOriginalIssuer when a different issuer tries to correct it", async function () {
        await actorRegistry.connect(company2).register(Role.Company, "Microsoft", "", ZERO_ADDRESS);
        await actorRegistry.connect(verifier).approveActor(company2.address);

        await credentialIssuer
          .connect(company1)
          .issueCredential(student1.address, SAMPLE_IPFS_HASH, CredentialType.Offer);

        await expect(
          credentialIssuer
            .connect(company2)
            .issueCorrection(student1.address, 0, SAMPLE_IPFS_HASH_2, CredentialType.Rejection)
        )
          .to.be.revertedWithCustomError(credentialIssuer, "NotOriginalIssuer")
          .withArgs(company2.address, 0);
      });

      it("should revert with CredentialAlreadySuperseded on a second direct correction of the same original", async function () {
        await credentialIssuer
          .connect(company1)
          .issueCredential(student1.address, SAMPLE_IPFS_HASH, CredentialType.Offer);
        await credentialIssuer
          .connect(company1)
          .issueCorrection(student1.address, 0, SAMPLE_IPFS_HASH_2, CredentialType.Rejection);

        await expect(
          credentialIssuer
            .connect(company1)
            .issueCorrection(student1.address, 0, SAMPLE_IPFS_HASH, CredentialType.Offer)
        )
          .to.be.revertedWithCustomError(credentialIssuer, "CredentialAlreadySuperseded")
          .withArgs(0);
      });

      it("should allow correcting a correction (chaining)", async function () {
        await credentialIssuer
          .connect(company1)
          .issueCredential(student1.address, SAMPLE_IPFS_HASH, CredentialType.Offer); // id 0
        await credentialIssuer
          .connect(company1)
          .issueCorrection(student1.address, 0, SAMPLE_IPFS_HASH_2, CredentialType.Rejection); // id 1, corrects 0

        await expect(
          credentialIssuer
            .connect(company1)
            .issueCorrection(student1.address, 1, SAMPLE_IPFS_HASH, CredentialType.Offer) // id 2, corrects 1
        ).to.not.be.reverted;

        expect(await credentialIssuer.isPlaced(student1.address)).to.be.true;
        const creds = await credentialIssuer.getStudentCredentials(student1.address);
        expect(creds.length).to.equal(3);
        expect(creds[1].superseded).to.be.true;
        expect(creds[2].supersedesId).to.equal(1);
      });

      it("should keep the full original+correction history visible via getStudentCredentials", async function () {
        await credentialIssuer
          .connect(company1)
          .issueCredential(student1.address, SAMPLE_IPFS_HASH, CredentialType.Offer);
        await credentialIssuer
          .connect(company1)
          .issueCorrection(student1.address, 0, SAMPLE_IPFS_HASH_2, CredentialType.Rejection);

        const creds = await credentialIssuer.getStudentCredentials(student1.address);
        expect(creds.length).to.equal(2);
        expect(creds[0].id).to.equal(0);
        expect(creds[0].isCorrection).to.be.false;
        expect(creds[1].id).to.equal(1);
        expect(creds[1].isCorrection).to.be.true;
      });

      it("should still enforce issuer/recipient authorization on issueCorrection", async function () {
        await credentialIssuer
          .connect(company1)
          .issueCredential(student1.address, SAMPLE_IPFS_HASH, CredentialType.Offer);

        await expect(
          credentialIssuer
            .connect(student2)
            .issueCorrection(student1.address, 0, SAMPLE_IPFS_HASH, CredentialType.Rejection)
        ).to.be.revertedWithCustomError(credentialIssuer, "NotAuthorizedIssuer");
      });
    });
  });

  // =========================================================================
  // 3. PlacementTracker Tests
  // =========================================================================
  describe("PlacementTracker", function () {

    beforeEach(async function () {
      await actorRegistry.connect(college1).register(Role.College, "IIT Bombay", "", ZERO_ADDRESS);
      await actorRegistry.connect(verifier).approveActor(college1.address);

      await actorRegistry.connect(company1).register(Role.Company, "Google", "", ZERO_ADDRESS);
      await actorRegistry.connect(verifier).approveActor(company1.address);

      await actorRegistry.connect(student1).register(Role.Student, "Alice", "", college1.address);
    });

    describe("Deployment", function () {
      it("should store the correct registry address", async function () {
        expect(await placementTracker.actorRegistry()).to.equal(
          await actorRegistry.getAddress()
        );
      });

      it("should revert if deployed with a zero registry address", async function () {
        const PlacementTracker = await ethers.getContractFactory("PlacementTracker");
        await expect(
          PlacementTracker.deploy(ZERO_ADDRESS)
        ).to.be.revertedWithCustomError(PlacementTracker, "InvalidRegistryAddress");
      });

      it("should start with zero nextVisitId and no visits for any college", async function () {
        expect(await placementTracker.nextVisitId()).to.equal(0);
        expect(await placementTracker.getCollegeVisitCount(college1.address)).to.equal(0);
      });
    });

    describe("Announcing Visits — On-Chain Input Bounds", function () {
      it("should revert with InvalidCompanyNameLength for an empty company name", async function () {
        await expect(
          placementTracker.connect(college1).announceVisit("", SAMPLE_IPFS_HASH, 1735689600)
        )
          .to.be.revertedWithCustomError(placementTracker, "InvalidCompanyNameLength")
          .withArgs(0);
      });

      it("should revert with InvalidCompanyNameLength over the cap", async function () {
        await expect(
          placementTracker.connect(college1).announceVisit("C".repeat(151), SAMPLE_IPFS_HASH, 1735689600)
        )
          .to.be.revertedWithCustomError(placementTracker, "InvalidCompanyNameLength")
          .withArgs(151);
      });

      it("should revert with InvalidIpfsHashLength for an empty hash", async function () {
        await expect(
          placementTracker.connect(college1).announceVisit("Microsoft India", "", 1735689600)
        )
          .to.be.revertedWithCustomError(placementTracker, "InvalidIpfsHashLength")
          .withArgs(0);
      });

      it("should revert with InvalidVisitDate for a zero date", async function () {
        await expect(
          placementTracker.connect(college1).announceVisit("Microsoft India", SAMPLE_IPFS_HASH, 0)
        ).to.be.revertedWithCustomError(placementTracker, "InvalidVisitDate");
      });
    });

    describe("Announcing Visits — Authorization", function () {
      it("should allow an Active College to announce a visit", async function () {
        await expect(
          placementTracker
            .connect(college1)
            .announceVisit("Microsoft India", SAMPLE_IPFS_HASH, 1735689600)
        ).to.not.be.reverted;
      });

      it("should revert with NotActiveCollege for a still-Pending College", async function () {
        await actorRegistry.connect(college2).register(Role.College, "IIT Delhi", "", ZERO_ADDRESS);
        await expect(
          placementTracker
            .connect(college2)
            .announceVisit("Microsoft India", SAMPLE_IPFS_HASH, 1735689600)
        )
          .to.be.revertedWithCustomError(placementTracker, "NotActiveCollege")
          .withArgs(college2.address);
      });

      it("should revert with NotActiveCollege when a Company tries to announce", async function () {
        await expect(
          placementTracker
            .connect(company1)
            .announceVisit("Microsoft India", SAMPLE_IPFS_HASH, 1735689600)
        )
          .to.be.revertedWithCustomError(placementTracker, "NotActiveCollege")
          .withArgs(company1.address);
      });

      it("should revert with NotActiveCollege when a Student tries to announce", async function () {
        await expect(
          placementTracker
            .connect(student1)
            .announceVisit("Microsoft India", SAMPLE_IPFS_HASH, 1735689600)
        )
          .to.be.revertedWithCustomError(placementTracker, "NotActiveCollege")
          .withArgs(student1.address);
      });

      it("should revert with NotActiveCollege for an unregistered caller", async function () {
        await expect(
          placementTracker
            .connect(stranger)
            .announceVisit("Microsoft India", SAMPLE_IPFS_HASH, 1735689600)
        ).to.be.revertedWithCustomError(placementTracker, "NotActiveCollege");
      });
    });

    describe("Visit Data & Events", function () {
      it("should emit VisitAnnounced with correct parameters", async function () {
        const tx = await placementTracker
          .connect(college1)
          .announceVisit("Microsoft India", SAMPLE_IPFS_HASH, 1735689600);
        const receipt = await tx.wait();
        const block = await ethers.provider.getBlock(receipt.blockNumber);

        await expect(tx)
          .to.emit(placementTracker, "VisitAnnounced")
          .withArgs(college1.address, 0, "Microsoft India", SAMPLE_IPFS_HASH, 1735689600, block.timestamp);
      });

      it("should store and retrieve visit data via getCollegeVisits", async function () {
        await placementTracker
          .connect(college1)
          .announceVisit("Microsoft India", SAMPLE_IPFS_HASH, 1735689600);

        const visits = await placementTracker.getCollegeVisits(college1.address);
        expect(visits.length).to.equal(1);
        expect(visits[0].companyName).to.equal("Microsoft India");
        expect(visits[0].ipfsHash).to.equal(SAMPLE_IPFS_HASH);
        expect(visits[0].announcedBy).to.equal(college1.address);
      });

      it("should auto-increment visit IDs globally across colleges", async function () {
        await actorRegistry.connect(college2).register(Role.College, "IIT Delhi", "", ZERO_ADDRESS);
        await actorRegistry.connect(verifier).approveActor(college2.address);

        await placementTracker
          .connect(college1)
          .announceVisit("Microsoft India", SAMPLE_IPFS_HASH, 1735689600);
        await placementTracker
          .connect(college2)
          .announceVisit("Google", SAMPLE_IPFS_HASH_2, 1735776000);

        const college1Visits = await placementTracker.getCollegeVisits(college1.address);
        const college2Visits = await placementTracker.getCollegeVisits(college2.address);

        expect(college1Visits[0].id).to.equal(0);
        expect(college2Visits[0].id).to.equal(1);
        expect(await placementTracker.nextVisitId()).to.equal(2);
      });

      it("should isolate visits between different colleges", async function () {
        await actorRegistry.connect(college2).register(Role.College, "IIT Delhi", "", ZERO_ADDRESS);
        await actorRegistry.connect(verifier).approveActor(college2.address);

        await placementTracker
          .connect(college1)
          .announceVisit("Microsoft India", SAMPLE_IPFS_HASH, 1735689600);

        expect(await placementTracker.getCollegeVisitCount(college1.address)).to.equal(1);
        expect(await placementTracker.getCollegeVisitCount(college2.address)).to.equal(0);
      });
    });
  });
});
