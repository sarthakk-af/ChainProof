// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ActorRegistry.sol";

/**
 * @title CredentialIssuer
 * @author ChainProof Team
 * @notice On-chain issuance and management of verifiable placement credentials.
 *         This contract handles the complete lifecycle of a student's placement journey:
 *         from initial shortlisting to final offer or rejection.
 *
 * @dev Architecture Notes:
 *      - Maintains a reference to ActorRegistry for cross-contract role validation.
 *      - Credentials are stored in a per-student array, append-only — corrections (see
 *        `issueCorrection`) never edit or remove a row, only supersede it.
 *      - The `isPlaced` flag and `totalPlacedStudents` counters are re-derived by
 *        `_recomputePlacement` after every issuance or correction, so they always reflect
 *        the student's *current* non-superseded credentials, not just "has an Offer ever
 *        been issued."
 *      - Placement % is computed per-College: each student declared a College at
 *        registration, so `totalPlacedStudents` and `ActorRegistry.totalRegisteredStudents`
 *        are both keyed by College address. This is what lets the platform hold individual
 *        institutions accountable instead of only reporting one platform-wide figure.
 *
 * Security Model:
 *      - Checks-Effects-Interactions (CEI) pattern is strictly enforced.
 *      - Custom errors are used for all revert conditions (no expensive strings).
 *      - All state mutations emit indexed events for transparent off-chain indexing.
 *      - Issuers must be `Active` (verifier-approved) in ActorRegistry, not merely
 *        registered — an unverified College/Company cannot issue credentials.
 */
contract CredentialIssuer {

    // =========================================================================
    // ENUMS & STRUCTS
    // =========================================================================

    /**
     * @notice Represents the type/stage of a credential in the placement pipeline.
     * @dev The order of values matters for semantic readability in the frontend.
     */
    enum CredentialType {
        General,     // 0 - General achievement / certificate
        Shortlist,   // 1 - Student shortlisted for a role
        Interview,   // 2 - Interview completed
        Offer,       // 3 - Official offer letter issued
        Rejection    // 4 - Official rejection notice
    }

    /**
     * @notice A single verifiable credential entry on the blockchain.
     * @dev    Credentials are append-only: a mistake or a real-world reversal (e.g. a
     *         rescinded offer) is never edited or deleted, only superseded by a new,
     *         explicitly-linked correction record — see `issueCorrection`.
     * @param id            Auto-incrementing unique identifier for this credential.
     * @param ipfsHash      Content-addressed pointer to off-chain metadata (title, description,
     *                      issuer details, file attachments stored on IPFS/Pinata/Web3.Storage).
     * @param issuer        The Ethereum address of the entity that issued this credential.
     * @param timestamp     Block timestamp at the time of issuance (immutable proof of time).
     * @param credType      The stage/type of this credential in the pipeline.
     * @param isCorrection  True if this credential itself corrects an earlier one.
     * @param supersedesId  The id of the credential this corrects — only meaningful when
     *                      `isCorrection` is true.
     * @param superseded    True once some later correction has targeted this credential.
     */
    struct Credential {
        uint256 id;
        string ipfsHash;
        address issuer;
        uint256 timestamp;
        CredentialType credType;
        bool isCorrection;
        uint256 supersedesId;
        bool superseded;
    }

    // =========================================================================
    // CUSTOM ERRORS
    // =========================================================================

    /// @notice Thrown when a non-College/Company, or an unverified (non-Active), address
    ///         attempts to issue credentials.
    error NotAuthorizedIssuer(address caller);

    /// @notice Thrown when the credential recipient is not a registered Student.
    error RecipientNotStudent(address recipient);

    /// @notice Thrown when the registry address provided is the zero address.
    error InvalidRegistryAddress();

    /// @notice Thrown when `issueCorrection` targets a credential id the student doesn't have.
    error CredentialNotFound(address student, uint256 credentialId);

    /// @notice Thrown when the caller didn't issue the credential they're trying to correct.
    error NotOriginalIssuer(address caller, uint256 credentialId);

    /// @notice Thrown when `_ipfsHash` is empty or longer than `MAX_IPFS_HASH_LENGTH` bytes.
    error InvalidIpfsHashLength(uint256 length);

    /// @notice Thrown when trying to correct a credential that's already been superseded once.
    error CredentialAlreadySuperseded(uint256 credentialId);

    // =========================================================================
    // CONSTANTS
    // =========================================================================

    /**
     * @notice Byte-length bound on the IPFS hash stored with every credential.
     * @dev    Real CIDs are well under this (a CIDv0 is 46 characters, CIDv1
     *         base32 is 59). The cap exists because the backend's own limit
     *         can be bypassed by calling this contract directly — without it,
     *         a caller could push an arbitrarily long string into permanent
     *         storage that every future read of this student's history pays for.
     */
    uint256 public constant MAX_IPFS_HASH_LENGTH = 200;

    // =========================================================================
    // STATE VARIABLES
    // =========================================================================

    /// @notice Reference to the ActorRegistry contract for cross-contract role checks.
    /// @dev Set immutably at deployment; `immutable` saves ~2100 gas per read over `storage`.
    ActorRegistry public immutable actorRegistry;

    /// @notice Tracks whether a student has received an official Offer credential.
    ///         Used to prevent double-incrementing `totalPlacedStudents`.
    mapping(address => bool) public isPlaced;

    /// @notice Stores the full credential history for each student address.
    /// @dev Private to enforce read-through the `getStudentCredentials` getter.
    mapping(address => Credential[]) private studentCredentials;

    /// @notice Count of students who have received at least one Offer credential,
    ///         keyed by the student's declared College address (see ActorRegistry.college).
    ///         Combined with ActorRegistry.totalRegisteredStudents(college), this yields
    ///         a tamper-proof, per-College Placement %.
    mapping(address => uint256) public totalPlacedStudents;

    /// @notice Auto-incrementing counter for globally unique credential IDs.
    uint256 public nextCredentialId;

    // =========================================================================
    // EVENTS
    // =========================================================================

    /**
     * @notice Emitted when a new credential is successfully issued to a student — this
     *         covers both a fresh `issueCredential` and a follow-up `issueCorrection`.
     * @param student       The student's address receiving the credential.
     * @param issuer        The College or Company address issuing the credential.
     * @param id            The unique credential ID.
     * @param ipfsHash      The IPFS content hash of the credential metadata.
     * @param credType      The type/stage of the credential.
     * @param timestamp     The block timestamp of issuance.
     * @param isCorrection  True if this credential corrects an earlier one.
     * @param supersedesId  The id being corrected, meaningful only when `isCorrection` is true.
     */
    event CredentialIssued(
        address indexed student,
        address indexed issuer,
        uint256 indexed id,
        string ipfsHash,
        CredentialType credType,
        uint256 timestamp,
        bool isCorrection,
        uint256 supersedesId
    );

    /**
     * @notice Emitted whenever a student's placed status changes, in either direction.
     * @dev    Fired by `_recomputePlacement`, called from both `issueCredential` and
     *         `issueCorrection` — a rescinded offer can un-place a student just as a new
     *         offer (including one issued via correction) can place them.
     * @param student           The student's address.
     * @param college           The student's declared College address.
     * @param totalPlaced       The updated placed-student count for this College.
     * @param totalRegistered   The total registered students for this College.
     * @param placed            True if the student just became placed, false if just un-placed.
     */
    event StudentPlaced(
        address indexed student,
        address indexed college,
        uint256 totalPlaced,
        uint256 totalRegistered,
        bool placed
    );

    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================

    /**
     * @notice Initializes the contract with a reference to the ActorRegistry.
     * @dev    The registry address is stored as `immutable`, consuming zero runtime
     *         storage slots and reducing gas on every cross-contract call.
     * @param _registryAddress The deployed address of the ActorRegistry contract.
     */
    constructor(address _registryAddress) {
        if (_registryAddress == address(0)) {
            revert InvalidRegistryAddress();
        }
        actorRegistry = ActorRegistry(_registryAddress);
    }

    // =========================================================================
    // EXTERNAL FUNCTIONS
    // =========================================================================

    /**
     * @notice Issues a new verifiable credential to a student address.
     * @dev    Implements strict Checks-Effects-Interactions pattern:
     *         1. CHECKS: Validate issuer role + verification status, AND recipient role.
     *         2. EFFECTS: Update all state variables (credentials array, isPlaced, counters).
     *         3. INTERACTIONS: Emit events last (events are not re-entrancy vectors but
     *            this pattern ensures state integrity regardless).
     *
     * @param _student   The student's Ethereum address to receive the credential.
     * @param _ipfsHash  The IPFS content hash pointing to the full credential metadata.
     * @param _credType  The type/stage of this credential (see CredentialType enum).
     */
    function issueCredential(
        address _student,
        string calldata _ipfsHash,
        CredentialType _credType
    ) external {
        // --- CHECKS ---
        _checkIsActiveIssuer(msg.sender);
        _checkRecipientIsStudent(_student);
        _checkIpfsHash(_ipfsHash);

        // --- EFFECTS ---
        uint256 credentialId = nextCredentialId;
        unchecked { nextCredentialId++; }

        studentCredentials[_student].push(Credential({
            id:            credentialId,
            ipfsHash:      _ipfsHash,
            issuer:        msg.sender,
            timestamp:     block.timestamp,
            credType:      _credType,
            isCorrection:  false,
            supersedesId:  0,
            superseded:    false
        }));

        // --- INTERACTIONS (Events) ---
        emit CredentialIssued(
            _student,
            msg.sender,
            credentialId,
            _ipfsHash,
            _credType,
            block.timestamp,
            false,
            0
        );

        _recomputePlacement(_student);
    }

    /**
     * @notice Publishes a correction that supersedes an earlier credential, without ever
     *         editing or deleting it — e.g. a company rescinding an offer, or an issuer
     *         fixing a mistake. Only the address that issued the original may correct it.
     * @dev    Follows the same CEI structure as `issueCredential`. A correction can itself
     *         later be corrected (it's just another non-superseded row), but the *same*
     *         original credential can only be corrected once directly.
     *
     * @param _student              The student who holds the original credential.
     * @param _originalCredentialId The id of the credential being corrected.
     * @param _ipfsHash             IPFS content hash for the correction's own metadata.
     * @param _newCredType          The credential type this correction establishes.
     */
    function issueCorrection(
        address _student,
        uint256 _originalCredentialId,
        string calldata _ipfsHash,
        CredentialType _newCredType
    ) external {
        // --- CHECKS ---
        _checkIsActiveIssuer(msg.sender);
        _checkRecipientIsStudent(_student);
        _checkIpfsHash(_ipfsHash);

        Credential[] storage creds = studentCredentials[_student];
        uint256 originalIndex = type(uint256).max;
        for (uint256 i = 0; i < creds.length; i++) {
            if (creds[i].id == _originalCredentialId) {
                originalIndex = i;
                break;
            }
        }
        if (originalIndex == type(uint256).max) {
            revert CredentialNotFound(_student, _originalCredentialId);
        }
        if (creds[originalIndex].issuer != msg.sender) {
            revert NotOriginalIssuer(msg.sender, _originalCredentialId);
        }
        if (creds[originalIndex].superseded) {
            revert CredentialAlreadySuperseded(_originalCredentialId);
        }

        // --- EFFECTS ---
        creds[originalIndex].superseded = true;

        uint256 credentialId = nextCredentialId;
        unchecked { nextCredentialId++; }

        creds.push(Credential({
            id:            credentialId,
            ipfsHash:      _ipfsHash,
            issuer:        msg.sender,
            timestamp:     block.timestamp,
            credType:      _newCredType,
            isCorrection:  true,
            supersedesId:  _originalCredentialId,
            superseded:    false
        }));

        // --- INTERACTIONS (Events) ---
        emit CredentialIssued(
            _student,
            msg.sender,
            credentialId,
            _ipfsHash,
            _newCredType,
            block.timestamp,
            true,
            _originalCredentialId
        );

        _recomputePlacement(_student);
    }

    // =========================================================================
    // INTERNAL HELPERS
    // =========================================================================

    /// @notice Reverts unless `_caller` is a verifier-approved (Active) College or Company.
    function _checkIsActiveIssuer(address _caller) internal view {
        ActorRegistry.Role role = actorRegistry.getActorRole(_caller);
        bool roleValid = role == ActorRegistry.Role.College || role == ActorRegistry.Role.Company;
        if (!roleValid || !actorRegistry.isActive(_caller)) {
            revert NotAuthorizedIssuer(_caller);
        }
    }

    /// @notice Reverts unless `_student` is a registered Student.
    function _checkRecipientIsStudent(address _student) internal view {
        if (actorRegistry.getActorRole(_student) != ActorRegistry.Role.Student) {
            revert RecipientNotStudent(_student);
        }
    }

    /// @notice Reverts unless `_ipfsHash` is non-empty and within `MAX_IPFS_HASH_LENGTH` bytes.
    function _checkIpfsHash(string calldata _ipfsHash) internal pure {
        uint256 length = bytes(_ipfsHash).length;
        if (length == 0 || length > MAX_IPFS_HASH_LENGTH) {
            revert InvalidIpfsHashLength(length);
        }
    }

    /**
     * @notice Re-derives whether a student is placed from their current credential
     *         history and updates state/emits an event if that flips either direction.
     * @dev    "Placed" means at least one non-superseded Offer credential exists — so
     *         rescinding one of several offers doesn't un-place a student who still holds
     *         another, and correcting a Rejection into an Offer can newly place one.
     */
    function _recomputePlacement(address _student) internal {
        Credential[] storage creds = studentCredentials[_student];
        bool nowPlaced = false;
        for (uint256 i = 0; i < creds.length; i++) {
            if (creds[i].credType == CredentialType.Offer && !creds[i].superseded) {
                nowPlaced = true;
                break;
            }
        }

        bool wasPlaced = isPlaced[_student];
        if (nowPlaced == wasPlaced) return;

        address college = actorRegistry.getStudentCollege(_student);
        isPlaced[_student] = nowPlaced;
        if (nowPlaced) {
            unchecked { totalPlacedStudents[college]++; }
        } else {
            totalPlacedStudents[college]--;
        }

        emit StudentPlaced(
            _student,
            college,
            totalPlacedStudents[college],
            actorRegistry.totalRegisteredStudents(college),
            nowPlaced
        );
    }

    // =========================================================================
    // VIEW FUNCTIONS
    // =========================================================================

    /**
     * @notice Returns all credentials ever issued to a specific student.
     * @dev    Returns the full in-memory array. For large arrays (100+ credentials),
     *         consider paginating on the frontend or implementing an indexed subgraph.
     *
     * @param _student The student's address to query.
     * @return An array of Credential structs in chronological order of issuance.
     */
    function getStudentCredentials(address _student)
        external
        view
        returns (Credential[] memory)
    {
        return studentCredentials[_student];
    }

    /**
     * @notice Returns the count of credentials issued to a student.
     * @dev    Cheaper than fetching the full array if only the count is needed.
     * @param _student The student's address to query.
     * @return The number of credentials in the student's record.
     */
    function getStudentCredentialCount(address _student)
        external
        view
        returns (uint256)
    {
        return studentCredentials[_student].length;
    }

    /**
     * @notice Computes the current placement percentage for a specific College, as a
     *         scaled integer.
     * @dev    Returns value scaled by 100 (e.g., 7500 = 75.00%) to avoid floating
     *         point issues in Solidity. Divide by 100 on the frontend for display.
     *         Returns 0 if the College has no registered students, to prevent
     *         division-by-zero.
     *
     * @param _college The College address to compute placement percentage for.
     * @return Placement percentage scaled by 100 (basis points).
     */
    function getPlacementPercentage(address _college) external view returns (uint256) {
        uint256 totalRegistered = actorRegistry.totalRegisteredStudents(_college);
        if (totalRegistered == 0) return 0;
        return (totalPlacedStudents[_college] * 10000) / totalRegistered;
    }
}
