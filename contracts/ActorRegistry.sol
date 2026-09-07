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
 *      - Colleges and Companies must be approved by the platform `verifier` before they are
 *        considered `Active` — this is what stops any wallet from self-declaring as
 *        "IIT Bombay" and being treated as a legitimate, trusted institution. Students remain
 *        instantly self-serve since there is little incentive to falsely claim a role with no
 *        issuing power.
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
     *      must be approved by the `verifier` before they can issue credentials or otherwise
     *      act with authority on the platform.
     */
    enum Status {
        None,     // 0 - Default / not registered
        Pending,  // 1 - Registered, awaiting verifier approval (College/Company only)
        Active,   // 2 - Verified and authorized to act
        Rejected  // 3 - Verifier declined this registration
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

    // =========================================================================
    // STATE VARIABLES
    // =========================================================================

    /// @notice Maps each Ethereum address to its Actor identity record.
    mapping(address => Actor) private actors;

    /// @notice The platform admin address authorized to approve/reject College and Company
    ///         registrations. Intended to be rotated to a multisig in production.
    address public verifier;

    /// @notice Tracks how many students have successfully registered under each College.
    ///         Keyed by College address. Used by CredentialIssuer for per-college
    ///         placement percentage calculations.
    mapping(address => uint256) public totalRegisteredStudents;

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

    /// @notice Emitted when the platform verifier address is rotated.
    event VerifierUpdated(address indexed oldVerifier, address indexed newVerifier);

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
     * @dev    Verifier-only. This is the trust gate that prevents unverified institutions
     *         from issuing credentials or otherwise acting with authority.
     * @param _actor The address of the Pending actor to approve.
     */
    function approveActor(address _actor) external onlyVerifier {
        if (actors[_actor].status != Status.Pending) {
            revert ActorNotPending(_actor);
        }
        actors[_actor].status = Status.Active;
        emit ActorApproved(_actor, msg.sender);
    }

    /**
     * @notice Rejects a Pending College or Company registration.
     * @dev    Verifier-only. A rejected address may resubmit via `register` — this isn't
     *         a permanent ban — but `rejectionCount` permanently records that it happened.
     * @param _actor The address of the Pending actor to reject.
     */
    function rejectActor(address _actor) external onlyVerifier {
        Actor storage a = actors[_actor];
        if (a.status != Status.Pending) {
            revert ActorNotPending(_actor);
        }
        a.status = Status.Rejected;
        unchecked { a.rejectionCount++; }
        emit ActorRejected(_actor, msg.sender);
    }

    /**
     * @notice Rotates the platform verifier address.
     * @dev    Verifier-only. Intended to allow migrating from a single admin key to a
     *         multisig as the platform matures.
     * @param _newVerifier The new verifier address.
     */
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
     * @dev    This is the primary cross-contract call used by CredentialIssuer.sol
     *         to validate issuer and recipient privileges before credential issuance.
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
