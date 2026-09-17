// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ActorRegistry
 * @author ChainProof Team
 * @notice Decentralized identity, verification, and role management for the ChainProof
 *         ecosystem. This contract is the single source of truth for all actor identities
 *         (Students, Colleges, Companies) operating on the platform.
 *
 * @dev Security Model:
 *      - Uses custom errors instead of `require(string)` for gas efficiency.
 *      - All state-changing functions emit indexed events for off-chain indexing.
 *      - Registration is permissionless but role-locked; an address can only hold one role.
 *      - Colleges and Companies start `Pending` and must be admitted before they are
 *        `Active`: the platform `verifier` admits a College, and an Active College admits
 *        the Companies that recruit on its campus. This is what stops any wallet from
 *        self-declaring as "IIT Bombay" and being treated as a trusted institution.
 *      - Students are `Active` on registration. The contract cannot check a roll number,
 *        so the platform only submits a student's registration after matching them to
 *        their college's roster, off-chain.
 *      - An Active actor can be `Suspended` and reinstated. Suspension stops an account
 *        acting; it never alters anything that account already recorded.
 *      - Students declare their College at registration time. This is what makes per-college
 *        placement statistics possible — without it, accountability could only ever be computed
 *        platform-wide, which defeats the purpose of holding individual institutions accountable.
 */
contract ActorRegistry {

    // =========================================================================
    // ENUMS & STRUCTS
    // =========================================================================

    /**
     * @notice Defines the four possible identity states for any Ethereum address.
     * @dev `None` is the zero-value default, representing an unregistered address.
     */
    enum Role {
        None,     // 0 - Default / Unregistered
        Student,  // 1
        College,  // 2
        Company   // 3
    }

    /**
     * @notice Verification lifecycle state for a registered actor.
     * @dev Students move straight to `Active`. Colleges and Companies start `Pending` and
     *      must be approved before they can post drives, record outcomes or otherwise
     *      act with authority on the platform.
     */
    enum Status {
        None,      // 0 - Default / not registered
        Pending,   // 1 - Registered, awaiting verifier approval (College/Company only)
        Active,    // 2 - Verified and authorized to act
        Rejected,  // 3 - Verifier declined this registration
        Suspended  // 4 - Was Active; access withdrawn, reversible (see `suspendActor`)
    }

    /**
     * @notice Stores the metadata for a registered actor.
     * @param role     The role assigned to this actor.
     * @param status   The verification lifecycle state of this actor.
     * @param name     Human-readable name (e.g., university name, student name, company name).
     * @param metadata Additional off-chain data reference (e.g., IPFS hash of a profile JSON).
     * @param college  For Students only: the address of the College they declared at
     *                 registration. Zero address for College/Company actors.
     * @param rejectionCount Number of times this address has been rejected. Preserved
     *                 across a resubmission (see `register`) so a past rejection is never
     *                 silently forgotten, even after a later approval.
     */
    struct Actor {
        Role role;
        Status status;
        string name;
        string metadata;
        address college;
        uint8 rejectionCount;
    }

    // =========================================================================
    // CUSTOM ERRORS (Gas-Optimized over string require)
    // =========================================================================

    /// @notice Thrown when an address that is already Pending or Active attempts to
    ///         register again. A Rejected address may resubmit — see `register`.
    error AlreadyRegistered(address actor);

    /// @notice Thrown when a function caller does not have the required role.
    error Unauthorized(address caller, Role requiredRole);

    /// @notice Thrown when an invalid or `None` role is passed to a function.
    error InvalidRole(uint8 roleValue);

    /// @notice Thrown when a caller other than the platform verifier calls a verifier-only function.
    error NotVerifier(address caller);

    /// @notice Thrown when a Student attempts to register under a College that does not exist
    ///         or has not yet been verified as `Active`.
    error CollegeNotActive(address college);

    /// @notice Thrown when approving/rejecting an actor that is not currently `Pending`.
    error ActorNotPending(address actor);

    /// @notice Thrown when the zero address is passed where a real address is required.
    error ZeroAddress();

    /// @notice Thrown when `_name` is empty or longer than `MAX_NAME_LENGTH` bytes.
    error InvalidNameLength(uint256 length);

    /// @notice Thrown when `_metadata` is longer than `MAX_METADATA_LENGTH` bytes.
    error MetadataTooLong(uint256 length);

    /// @notice Thrown when the caller may not decide this actor's registration.
    /// @dev    The verifier admits Colleges; an Active College admits the Companies
    ///         that recruit on its campus. Nobody decides their own kind.
    error NotAuthorizedToDecide(address caller, address actor);

    /// @notice Thrown when suspending an actor that is not currently `Active`.
    error ActorNotActive(address actor);

    /// @notice Thrown when reinstating an actor that is not currently `Suspended`.
    error ActorNotSuspended(address actor);

    /// @notice Thrown when a suspension reason exceeds `MAX_REASON_LENGTH` bytes.
    error ReasonTooLong(uint256 length);

    /// @notice Thrown when a course code is empty or over `MAX_COURSE_CODE_LENGTH` bytes.
    error InvalidCourseCodeLength(uint256 length);

    /// @notice Thrown when a batch year falls outside a plausible range.
    error InvalidBatchYear(uint16 year);

    /// @notice Thrown when a declared batch strength exceeds `MAX_BATCH_STRENGTH`.
    error InvalidBatchStrength(uint256 strength);

    // =========================================================================
    // CONSTANTS
    // =========================================================================

    /**
     * @notice Byte-length bounds on the strings this contract stores forever.
     * @dev    The backend enforces these same limits before it ever submits a
     *         transaction, but a public chain means anyone can call `register`
     *         directly and skip that layer entirely — so the bounds have to
     *         exist here too, or "validated" only means "validated if you
     *         happened to use our frontend." Measured in bytes, not
     *         characters: a name in a multi-byte script (Devanagari, Tamil,
     *         etc.) uses ~3 bytes per character, so the backend measures byte
     *         length too rather than letting a name pass there and revert here.
     */
    uint256 public constant MAX_NAME_LENGTH = 100;
    uint256 public constant MAX_METADATA_LENGTH = 200;

    /// @notice Bound on the reason given for a suspension. Short on purpose: this is
    ///         a label for a record, not a case file.
    uint256 public constant MAX_REASON_LENGTH = 200;

    /// @notice Bounds on a declared batch: a course code like "CSE" or "MECH-B",
    ///         a plausible academic year, and a headcount no real cohort exceeds.
    uint256 public constant MAX_COURSE_CODE_LENGTH = 20;
    uint16 public constant MIN_BATCH_YEAR = 2000;
    uint16 public constant MAX_BATCH_YEAR = 2100;
    uint256 public constant MAX_BATCH_STRENGTH = 100000;

    // =========================================================================
    // STATE VARIABLES
    // =========================================================================

    /// @notice Maps each Ethereum address to its Actor identity record.
    mapping(address => Actor) private actors;

    /// @notice The platform admin address authorized to approve/reject College and Company
    ///         registrations. Intended to be rotated to a multisig in production.
    address public verifier;

    /// @notice Tracks how many students have successfully registered under each College.
    ///         Keyed by College address. Read directly from the chain, it gives anyone
    ///         the registered-student count without trusting the platform's database.
    mapping(address => uint256) public totalRegisteredStudents;

    /**
     * @notice How many students a College declares are in a given cohort.
     * @dev    This is the *denominator* of every placement percentage, and the one
     *         number the College itself supplies. A placement statistic is trivial
     *         to inflate by quietly shrinking it — "92% placed" meaning 92% of the
     *         60 students counted, out of a batch of 180. Recording it here, with
     *         the previous value in the event on every change, is what makes that
     *         impossible to do quietly: the College may run an opt-in scheme, but
     *         it cannot hide the shape of one.
     *
     *         Keyed by keccak256(courseCode, batchYear) since Solidity cannot use a
     *         string as a mapping key directly; the readable values live in the
     *         event and the struct.
     */
    struct Batch {
        string courseCode;
        uint16 batchYear;
        uint256 strength;
        bool exists;
    }
    mapping(address => mapping(bytes32 => Batch)) private batches;

    // =========================================================================
    // EVENTS
    // =========================================================================

    /**
     * @notice Emitted when a new actor successfully registers on the platform.
     * @param actor         The Ethereum address of the newly registered entity.
     * @param role          The role they registered under.
     * @param name          The name they provided during registration.
     * @param initialStatus The status assigned at registration (`Active` for Students,
     *                      `Pending` for Colleges/Companies).
     */
    event ActorRegistered(
        address indexed actor,
        Role indexed role,
        string name,
        Status initialStatus
    );

    /// @notice Emitted when the verifier approves a Pending College/Company registration.
    event ActorApproved(address indexed actor, address indexed verifier);

    /// @notice Emitted when the verifier rejects a Pending College/Company registration.
    event ActorRejected(address indexed actor, address indexed verifier);

    /**
     * @notice Emitted when an Active actor's access is withdrawn.
     * @dev    Carries the reason, because a suspension with no stated cause is
     *         indistinguishable from an arbitrary one — and the whole argument for
     *         an admin that only manages accounts is that what it does is visible.
     */
    event ActorSuspended(address indexed actor, address indexed by, string reason);

    /// @notice Emitted when a Suspended actor's access is restored.
    event ActorReinstated(address indexed actor, address indexed by);

    /// @notice Emitted when the platform verifier address is rotated.
    event VerifierUpdated(address indexed oldVerifier, address indexed newVerifier);

    /**
     * @notice Emitted whenever a College declares or revises a cohort's size.
     * @dev    Carries the previous value as well as the new one, so a reduction is
     *         as visible as the original declaration. Auditing the denominator is
     *         the entire point: without the old value, a College could restate
     *         180 as 60 and the record would look no different from a first entry.
     */
    event BatchStrengthRecorded(
        address indexed college,
        string courseCode,
        uint16 indexed batchYear,
        uint256 previousStrength,
        uint256 newStrength
    );

    // =========================================================================
    // MODIFIERS
    // =========================================================================

    /**
     * @notice Asserts that the calling address holds a specific role.
     * @dev Role-only check — does NOT imply `Active` status. See `isActive` for the
     *      authorization check that other contracts should use before granting privileges.
     * @param requiredRole The role the caller must possess.
     */
    modifier onlyRole(Role requiredRole) {
        if (actors[msg.sender].role != requiredRole) {
            revert Unauthorized(msg.sender, requiredRole);
        }
        _;
    }

    /// @notice Restricts function execution to the current platform verifier.
    modifier onlyVerifier() {
        if (msg.sender != verifier) {
            revert NotVerifier(msg.sender);
        }
        _;
    }

    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================

    /**
     * @notice Initializes the contract with the platform verifier address.
     * @param _verifier The address authorized to approve/reject College and Company registrations.
     */
    constructor(address _verifier) {
        if (_verifier == address(0)) {
            revert ZeroAddress();
        }
        verifier = _verifier;
    }

    // =========================================================================
    // EXTERNAL FUNCTIONS
    // =========================================================================

    /**
     * @notice Registers the calling address with a specified role and metadata.
     * @dev    Students are activated immediately and must declare an already-`Active`
     *         College. Colleges and Companies are registered as `Pending` and require
     *         verifier approval via `approveActor` before they can act with authority.
     *
     *         A previously-Rejected address may resubmit — a rejection is a "try again",
     *         not a permanent ban. The resubmission fully replaces the actor record (it
     *         may even pick a different role) except `rejectionCount`, which carries over
     *         so the fact that this address was rejected before is never hidden.
     *
     * @param _role           The desired role (must be 1=Student, 2=College, or 3=Company).
     * @param _name           A human-readable name for this actor.
     * @param _metadata       An optional IPFS hash or metadata string for the actor profile.
     * @param _collegeAddress Required for Students only: the address of their College.
     *                        Ignored for College/Company registrations.
     */
    function register(
        Role _role,
        string calldata _name,
        string calldata _metadata,
        address _collegeAddress
    ) external {
        // --- CHECKS ---
        Actor storage existing = actors[msg.sender];
        // Block re-registration unless the only prior attempt was Rejected.
        if (existing.role != Role.None && existing.status != Status.Rejected) {
            revert AlreadyRegistered(msg.sender);
        }
        // Prevent registering with the `None` role (role value 0)
        if (_role == Role.None) {
            revert InvalidRole(uint8(_role));
        }
        // Bound what gets written to storage permanently — see MAX_NAME_LENGTH.
        uint256 nameLength = bytes(_name).length;
        if (nameLength == 0 || nameLength > MAX_NAME_LENGTH) {
            revert InvalidNameLength(nameLength);
        }
        uint256 metadataLength = bytes(_metadata).length;
        if (metadataLength > MAX_METADATA_LENGTH) {
            revert MetadataTooLong(metadataLength);
        }

        address collegeRef = address(0);
        Status initialStatus;

        if (_role == Role.Student) {
            // Students must declare an already-verified, Active College
            if (
                actors[_collegeAddress].role != Role.College ||
                actors[_collegeAddress].status != Status.Active
            ) {
                revert CollegeNotActive(_collegeAddress);
            }
            collegeRef = _collegeAddress;
            initialStatus = Status.Active;
        } else {
            // College and Company registrations start Pending until verifier approval
            initialStatus = Status.Pending;
        }

        // --- EFFECTS ---
        uint8 priorRejections = existing.rejectionCount;
        actors[msg.sender] = Actor({
            role: _role,
            status: initialStatus,
            name: _name,
            metadata: _metadata,
            college: collegeRef,
            rejectionCount: priorRejections
        });

        if (_role == Role.Student) {
            // Overflow not possible in practice: unchecked saves ~50 gas
            unchecked { totalRegisteredStudents[collegeRef]++; }
        }

        // --- INTERACTIONS (none: pure state update) ---
        emit ActorRegistered(msg.sender, _role, _name, initialStatus);
    }

    /**
     * @notice Approves a Pending College or Company, activating their platform privileges.
     * @dev    The trust gate that stops an unadmitted institution from acting with
     *         authority. Who may call it depends on the target — see `_checkMayDecide`.
     * @param _actor The address of the Pending actor to approve.
     */
    function approveActor(address _actor) external {
        _checkMayDecide(_actor);
        if (actors[_actor].status != Status.Pending) {
            revert ActorNotPending(_actor);
        }
        actors[_actor].status = Status.Active;
        emit ActorApproved(_actor, msg.sender);
    }

    /**
     * @notice Rejects a Pending College or Company registration.
     * @dev    Same authority as `approveActor`. A rejected address may resubmit via `register` — this isn't
     *         a permanent ban — but `rejectionCount` permanently records that it happened.
     * @param _actor The address of the Pending actor to reject.
     */
    function rejectActor(address _actor) external {
        _checkMayDecide(_actor);
        Actor storage a = actors[_actor];
        if (a.status != Status.Pending) {
            revert ActorNotPending(_actor);
        }
        a.status = Status.Rejected;
        unchecked { a.rejectionCount++; }
        emit ActorRejected(_actor, msg.sender);
    }

    /**
     * @notice Withdraws an Active actor's access without erasing anything they did.
     * @dev    The admin's only power over an account, and deliberately the limit of
     *         it. A fake company, a shared student login, an account that has to stop
     *         acting today — all of those need an answer, and "edit the database" is
     *         not one, because an admin who can edit records makes every record it
     *         touches worthless.
     *
     *         Suspension is reversible and additive: the drives, stages and offers
     *         this address already signed stay exactly as they were. What changes is
     *         that `isActive` now returns false, so nothing new can be signed.
     *
     *         Authority follows the same split as approval — the verifier suspends a
     *         College or Student, and a College may suspend a Company recruiting on
     *         its own campus.
     * @param _actor  The Active actor to suspend.
     * @param _reason Short, public statement of why.
     */
    function suspendActor(address _actor, string calldata _reason) external {
        _checkMayDecide(_actor);
        if (bytes(_reason).length > MAX_REASON_LENGTH) {
            revert ReasonTooLong(bytes(_reason).length);
        }
        Actor storage a = actors[_actor];
        if (a.status != Status.Active) {
            revert ActorNotActive(_actor);
        }
        a.status = Status.Suspended;
        emit ActorSuspended(_actor, msg.sender, _reason);
    }

    /**
     * @notice Restores a Suspended actor to Active.
     * @dev    A suspension that could not be lifted would be a ban by another name,
     *         and this admin is explicitly not a judge. Same authority as suspending.
     * @param _actor The Suspended actor to reinstate.
     */
    function reinstateActor(address _actor) external {
        _checkMayDecide(_actor);
        Actor storage a = actors[_actor];
        if (a.status != Status.Suspended) {
            revert ActorNotSuspended(_actor);
        }
        a.status = Status.Active;
        emit ActorReinstated(_actor, msg.sender);
    }

    /**
     * @notice Rotates the platform verifier address.
     * @dev    Verifier-only. Intended to allow migrating from a single admin key to a
     *         multisig as the platform matures.
     * @param _newVerifier The new verifier address.
     */
    /**
     * @notice Reverts unless the caller may decide `_actor`'s registration.
     * @dev    Two different gates, because two different questions are being
     *         answered:
     *           - a **College** is admitted by the platform verifier. That is a
     *             one-time bootstrap: somebody has to vouch for the institution.
     *           - a **Company** is admitted by an Active College. A college decides
     *             who recruits on its own campus, which is a domain decision, not
     *             an administrative one.
     *
     *         Note what this deliberately does not allow: the College confirms a
     *         Company may take part, but never writes that Company's data or its
     *         hiring outcomes. Gatekeeper, never author.
     */
    function _checkMayDecide(address _actor) internal view {
        Role targetRole = actors[_actor].role;

        if (targetRole == Role.Company) {
            bool callerIsActiveCollege =
                actors[msg.sender].role == Role.College &&
                actors[msg.sender].status == Status.Active;
            if (!callerIsActiveCollege && msg.sender != verifier) {
                revert NotAuthorizedToDecide(msg.sender, _actor);
            }
            return;
        }

        if (msg.sender != verifier) {
            revert NotAuthorizedToDecide(msg.sender, _actor);
        }
    }

    /**
     * @notice Declares, or revises, how many students are in one cohort.
     * @dev    College-only, and only once Active. See the `batches` mapping for why
     *         this lives on-chain at all.
     * @param _courseCode  Short course identifier, e.g. "CSE".
     * @param _batchYear   Graduating year of the cohort.
     * @param _strength    Total number of students in it.
     */
    function recordBatchStrength(
        string calldata _courseCode,
        uint16 _batchYear,
        uint256 _strength
    ) external onlyRole(Role.College) {
        if (actors[msg.sender].status != Status.Active) {
            revert Unauthorized(msg.sender, Role.College);
        }

        uint256 codeLength = bytes(_courseCode).length;
        if (codeLength == 0 || codeLength > MAX_COURSE_CODE_LENGTH) {
            revert InvalidCourseCodeLength(codeLength);
        }
        if (_batchYear < MIN_BATCH_YEAR || _batchYear > MAX_BATCH_YEAR) {
            revert InvalidBatchYear(_batchYear);
        }
        if (_strength == 0 || _strength > MAX_BATCH_STRENGTH) {
            revert InvalidBatchStrength(_strength);
        }

        bytes32 key = batchKey(_courseCode, _batchYear);
        Batch storage batch = batches[msg.sender][key];
        uint256 previous = batch.exists ? batch.strength : 0;

        batch.courseCode = _courseCode;
        batch.batchYear = _batchYear;
        batch.strength = _strength;
        batch.exists = true;

        emit BatchStrengthRecorded(msg.sender, _courseCode, _batchYear, previous, _strength);
    }

    /// @notice The storage key for one cohort. Public so callers can derive it too.
    function batchKey(string memory _courseCode, uint16 _batchYear) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(_courseCode, _batchYear));
    }

    /// @notice Returns a declared cohort. `exists` is false if never declared.
    function getBatch(address _college, string calldata _courseCode, uint16 _batchYear)
        external
        view
        returns (Batch memory)
    {
        return batches[_college][batchKey(_courseCode, _batchYear)];
    }

    function setVerifier(address _newVerifier) external onlyVerifier {
        if (_newVerifier == address(0)) {
            revert ZeroAddress();
        }
        address old = verifier;
        verifier = _newVerifier;
        emit VerifierUpdated(old, _newVerifier);
    }

    // =========================================================================
    // VIEW FUNCTIONS (Gas-Optimized Reads)
    // =========================================================================

    /**
     * @notice Returns the Role enum value for a given address.
     * @dev    Used by PlacementDrive, DriveOutcomes and PreparationLog, alongside
     *         `isActive`, to check who is calling before accepting a write.
     *         Being a `view` function, this does NOT cost gas when called externally
     *         off-chain (e.g., from a frontend).
     *
     * @param _actor The address to query.
     * @return The Role enum of the specified address (0=None if unregistered).
     */
    function getActorRole(address _actor) external view returns (Role) {
        return actors[_actor].role;
    }

    /**
     * @notice Returns whether an address is a verified, authorized actor.
     * @dev    This is the real authorization gate other contracts should use — `role != None`
     *         alone is not enough, since Colleges/Companies start `Pending` until verified.
     * @param _actor The address to query.
     * @return True if the address's status is `Active`.
     */
    function isActive(address _actor) external view returns (bool) {
        return actors[_actor].status == Status.Active;
    }

    /**
     * @notice Returns the College address a Student declared at registration.
     * @dev    Cheaper than fetching the full Actor struct when only the college is needed.
     * @param _student The student's address to query.
     * @return The College address, or the zero address if not a Student / not registered.
     */
    function getStudentCollege(address _student) external view returns (address) {
        return actors[_student].college;
    }

    /**
     * @notice Returns the full Actor record for a given address.
     * @dev    Used by the frontend to display profile details on dashboards.
     *
     * @param _actor The address to query.
     * @return The Actor struct containing role, status, name, metadata, and college.
     */
    function getActor(address _actor) external view returns (Actor memory) {
        return actors[_actor];
    }

    /**
     * @notice Convenience function to check if an address is registered.
     * @dev    Does NOT imply `Active` — a Pending or Rejected actor is still "registered".
     *         Use `isActive` to check authorization.
     * @param _actor The address to check.
     * @return True if the address has any role other than None.
     */
    function isRegistered(address _actor) external view returns (bool) {
        return actors[_actor].role != Role.None;
    }
}
