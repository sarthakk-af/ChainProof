// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ActorRegistry.sol";

/**
 * @title PlacementTracker
 * @author ChainProof Team
 * @notice Permanent, timestamped log of company visits announced by Colleges. This gives
 *         the platform's public accountability dashboard a real, durable record of
 *         recruitment activity per institution — data that previously only existed as
 *         ephemeral frontend state.
 *
 * @dev Architecture Notes:
 *      - Maintains a reference to ActorRegistry for cross-contract role/verification checks.
 *      - Only verifier-approved (Active) Colleges may announce visits.
 *      - Visits are stored per-College, optimized for sequential reads on a college's
 *        own announcement history.
 */
contract PlacementTracker {

    // =========================================================================
    // STRUCTS
    // =========================================================================

    /**
     * @notice A single company-visit announcement published by a College.
     * @param id           Globally unique, auto-incrementing identifier for this visit.
     * @param companyName  Human-readable name of the visiting company.
     * @param ipfsHash     Content-addressed pointer to extended details (roles, eligibility).
     * @param visitDate    Unix timestamp of the scheduled/occurred visit date.
     * @param announcedBy  The College address that published this announcement.
     * @param timestamp    Block timestamp at the time the announcement was published.
     */
    struct Visit {
        uint256 id;
        string companyName;
        string ipfsHash;
        uint256 visitDate;
        address announcedBy;
        uint256 timestamp;
    }

    // =========================================================================
    // CUSTOM ERRORS
    // =========================================================================

    /// @notice Thrown when a caller that is not a verifier-approved (Active) College
    ///         attempts to announce a visit.
    error NotActiveCollege(address caller);

    /// @notice Thrown when the registry address provided is the zero address.
    error InvalidRegistryAddress();

    /// @notice Thrown when `_companyName` is empty or exceeds `MAX_COMPANY_NAME_LENGTH` bytes.
    error InvalidCompanyNameLength(uint256 length);

    /// @notice Thrown when `_ipfsHash` is empty or exceeds `MAX_IPFS_HASH_LENGTH` bytes.
    error InvalidIpfsHashLength(uint256 length);

    /// @notice Thrown when `_visitDate` is zero, which is never a real date.
    error InvalidVisitDate();

    // =========================================================================
    // CONSTANTS
    // =========================================================================

    /**
     * @notice Byte-length bounds on the strings stored with every announcement.
     * @dev    Mirrors the backend's own limits — but the backend can be
     *         bypassed by calling this contract directly on a public chain,
     *         so the bounds have to be enforced at this layer to actually mean
     *         anything. Byte length, not character count (see ActorRegistry).
     */
    uint256 public constant MAX_COMPANY_NAME_LENGTH = 150;
    uint256 public constant MAX_IPFS_HASH_LENGTH = 200;

    // =========================================================================
    // STATE VARIABLES
    // =========================================================================

    /// @notice Reference to the ActorRegistry contract for cross-contract role checks.
    ActorRegistry public immutable actorRegistry;

    /// @notice Stores the full visit-announcement history for each College address.
    mapping(address => Visit[]) private collegeVisits;

    /// @notice Auto-incrementing counter for globally unique visit IDs.
    uint256 public nextVisitId;

    // =========================================================================
    // EVENTS
    // =========================================================================

    /**
     * @notice Emitted when a College publishes a new company-visit announcement.
     * @param college     The College address that published the announcement.
     * @param id          The unique visit ID.
     * @param companyName The name of the visiting company.
     * @param ipfsHash    The IPFS content hash of the extended visit details.
     * @param visitDate   The scheduled/occurred visit date (Unix timestamp).
     * @param timestamp   The block timestamp of publication.
     */
    event VisitAnnounced(
        address indexed college,
        uint256 indexed id,
        string companyName,
        string ipfsHash,
        uint256 visitDate,
        uint256 timestamp
    );

    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================

    /**
     * @notice Initializes the contract with a reference to the ActorRegistry.
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
     * @notice Publishes a permanent company-visit announcement for the calling College.
     * @dev    Only verifier-approved (Active) Colleges may call this — an unverified
     *         registration cannot publish announcements under an institution's name.
     *
     * @param _companyName Name of the visiting company.
     * @param _ipfsHash    IPFS content hash of extended details (roles, eligibility, etc.).
     * @param _visitDate   Unix timestamp of the scheduled/occurred visit date.
     */
    function announceVisit(
        string calldata _companyName,
        string calldata _ipfsHash,
        uint256 _visitDate
    ) external {
        // --- CHECKS ---
        ActorRegistry.Role role = actorRegistry.getActorRole(msg.sender);
        if (role != ActorRegistry.Role.College || !actorRegistry.isActive(msg.sender)) {
            revert NotActiveCollege(msg.sender);
        }
        uint256 nameLength = bytes(_companyName).length;
        if (nameLength == 0 || nameLength > MAX_COMPANY_NAME_LENGTH) {
            revert InvalidCompanyNameLength(nameLength);
        }
        uint256 hashLength = bytes(_ipfsHash).length;
        if (hashLength == 0 || hashLength > MAX_IPFS_HASH_LENGTH) {
            revert InvalidIpfsHashLength(hashLength);
        }
        if (_visitDate == 0) {
            revert InvalidVisitDate();
        }

        // --- EFFECTS ---
        uint256 visitId = nextVisitId;
        unchecked { nextVisitId++; }

        collegeVisits[msg.sender].push(Visit({
            id:          visitId,
            companyName: _companyName,
            ipfsHash:    _ipfsHash,
            visitDate:   _visitDate,
            announcedBy: msg.sender,
            timestamp:   block.timestamp
        }));

        // --- INTERACTIONS (Events) ---
        emit VisitAnnounced(msg.sender, visitId, _companyName, _ipfsHash, _visitDate, block.timestamp);
    }

    // =========================================================================
    // VIEW FUNCTIONS
    // =========================================================================

    /**
     * @notice Returns all visit announcements published by a specific College.
     * @param _college The College address to query.
     * @return An array of Visit structs in chronological order of publication.
     */
    function getCollegeVisits(address _college) external view returns (Visit[] memory) {
        return collegeVisits[_college];
    }

    /**
     * @notice Returns the count of visit announcements published by a College.
     * @param _college The College address to query.
     * @return The number of visits announced by this College.
     */
    function getCollegeVisitCount(address _college) external view returns (uint256) {
        return collegeVisits[_college].length;
    }
}
