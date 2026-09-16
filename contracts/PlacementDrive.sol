// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ActorRegistry.sol";

/**
 * @title PlacementDrive
 * @author ChainProof Team
 * @notice The permanent record of a recruitment drive: what a company came to offer,
 *         who it said was eligible, and the fact that the college agreed to host it.
 *
 * @dev Replaces PlacementTracker, which recorded a *college's* announcement that a
 *      company would visit. That had the wrong author. A college describing an offer
 *      on a company's behalf is exactly the self-reporting this platform exists to
 *      remove — the college could state any package it liked. Here the company posts
 *      its own opening and the college only agrees to host it.
 *
 *      The division of authority, which the whole design rests on:
 *        - the **company** writes the opening, the package, and the criteria;
 *        - the **college** approves that the drive may run on its campus;
 *        - neither can edit what the other wrote.
 *
 *      Why the criteria live on-chain rather than only in the off-chain job
 *      description: they are published *before* applications open, so they cannot be
 *      quietly tightened afterwards to explain away a rejection. A student refused for
 *      a CGPA cutoff can check the cutoff that was actually advertised.
 *
 *      Individual applications are deliberately NOT on-chain: they are personal data,
 *      there are hundreds per drive, and no single one is disputed. The *total* is,
 *      because it is the first bar of the public funnel and shapes every conversion
 *      rate read from it — see `recordApplicationCount`.
 */
contract PlacementDrive {

    // =========================================================================
    // ENUMS & STRUCTS
    // =========================================================================

    /**
     * @notice Lifecycle of a drive.
     * @dev    Nothing is ever deleted. A drive that is called off becomes Cancelled and
     *         stays visible, because "this company withdrew" is itself a fact a student
     *         or parent has a right to see.
     */
    enum DriveStatus {
        None,       // 0 - no such drive
        Proposed,   // 1 - posted by the company, awaiting the college
        Approved,   // 2 - college agreed to host; visible to students
        Rejected,   // 3 - college declined to host
        Closed,     // 4 - applications closed by the company
        Cancelled   // 5 - called off after approval, by either party
    }

    /**
     * @notice One recruitment drive.
     * @param id                  Globally unique, auto-incrementing identifier.
     * @param company             The company that posted it. Sole author of the terms.
     * @param college             The college whose campus it runs on.
     * @param roleTitle           The role being recruited for, e.g. "Software Engineer".
     * @param annualPackage       Advertised annual CTC, in whole rupees.
     * @param minCgpaScaled       Minimum CGPA, scaled by 100 (750 = 7.50). 0 = no cutoff.
     * @param batchYear           Graduating year the drive is open to.
     * @param applicationDeadline Unix timestamp after which applications close.
     * @param driveDate           Unix timestamp of the drive itself.
     * @param ipfsHash            Content-addressed pointer to the full job description.
     * @param status              Current lifecycle position.
     * @param postedAt            Block timestamp when the company posted it.
     */
    struct Drive {
        uint256 id;
        address company;
        address college;
        string roleTitle;
        uint256 annualPackage;
        uint16 minCgpaScaled;
        uint16 batchYear;
        uint256 applicationDeadline;
        uint256 driveDate;
        string ipfsHash;
        DriveStatus status;
        uint256 postedAt;
    }

    // =========================================================================
    // CUSTOM ERRORS
    // =========================================================================

    /// @notice Thrown when the registry address provided is the zero address.
    error InvalidRegistryAddress();

    /// @notice Thrown when a non-Company, or an unapproved Company, tries to post a drive.
    error NotActiveCompany(address caller);

    /// @notice Thrown when the named college isn't a verifier-approved Active College.
    error NotActiveCollege(address college);

    /// @notice Thrown when the referenced drive does not exist.
    error DriveNotFound(uint256 driveId);

    /// @notice Thrown when an action requires a different lifecycle status than the current one.
    error WrongDriveStatus(uint256 driveId, DriveStatus current);

    /// @notice Thrown when the caller may not take this action on this drive.
    error NotAuthorizedForDrive(address caller, uint256 driveId);

    /// @notice Thrown when `_roleTitle` is empty or longer than `MAX_ROLE_TITLE_LENGTH` bytes.
    error InvalidRoleTitleLength(uint256 length);

    /// @notice Thrown when `_ipfsHash` is empty or longer than `MAX_IPFS_HASH_LENGTH` bytes.
    error InvalidIpfsHashLength(uint256 length);

    /// @notice Thrown when the advertised package is implausible.
    error InvalidPackage(uint256 annualPackage);

    /// @notice Thrown when the CGPA cutoff is above the maximum possible CGPA.
    error InvalidCgpa(uint16 minCgpaScaled);

    /// @notice Thrown when a batch year falls outside a plausible range.
    error InvalidBatchYear(uint16 batchYear);

    /// @notice Thrown when a date is zero, or the deadline falls after the drive itself.
    error InvalidDriveDates(uint256 applicationDeadline, uint256 driveDate);

    /// @notice Thrown when a declared application count exceeds `MAX_APPLICATION_COUNT`.
    error InvalidApplicationCount(uint256 count);

    // =========================================================================
    // CONSTANTS
    // =========================================================================

    /**
     * @notice Bounds on everything this contract stores permanently.
     * @dev    The backend enforces the same limits, but a public chain means anyone can
     *         call this directly and skip that layer — so "validated" would otherwise
     *         only mean "validated if you happened to use our frontend". Byte lengths,
     *         not character counts: a role title in a multi-byte script uses roughly
     *         three bytes per character.
     */
    uint256 public constant MAX_ROLE_TITLE_LENGTH = 100;
    uint256 public constant MAX_IPFS_HASH_LENGTH = 200;

    /// @notice One lakh crore rupees — far beyond any real salary, but a finite ceiling.
    uint256 public constant MAX_ANNUAL_PACKAGE = 1e12;

    /// @notice CGPA is stored scaled by 100, so 10.00 is 1000.
    uint16 public constant MAX_CGPA_SCALED = 1000;

    uint16 public constant MIN_BATCH_YEAR = 2000;
    uint16 public constant MAX_BATCH_YEAR = 2100;

    /// @notice Far beyond any real drive's applicant pool, but a finite ceiling.
    uint256 public constant MAX_APPLICATION_COUNT = 1e6;

    // =========================================================================
    // STATE VARIABLES
    // =========================================================================

    /// @notice Reference to ActorRegistry for cross-contract role checks.
    /// @dev Set immutably at deployment; `immutable` saves ~2100 gas per read over storage.
    ActorRegistry public immutable actorRegistry;

    /// @notice Every drive ever posted, by id. Append-only.
    mapping(uint256 => Drive) private drives;

    /// @notice Auto-incrementing counter for globally unique drive ids.
    uint256 public nextDriveId;

    /**
     * @notice How many students applied to a drive, as attested by the company.
     * @dev    Individual applications stay off-chain: they are personal data, there
     *         are hundreds per drive, and nothing about any single one is disputed.
     *         The *total* is different — it is the first bar of the public funnel,
     *         and the only number there that would otherwise rest on the platform's
     *         own word. "12 offered out of 140" and "12 offered out of 20" describe
     *         the same event very differently.
     *
     *         Written by the **company**, deliberately, not the college. The company
     *         receives the applications and has nothing to gain from the figure; the
     *         college, whose conversion rate it shapes, does. Same principle as
     *         everywhere else here: whoever has no incentive to shade a number is the
     *         one who signs it.
     *
     *         `recorded` distinguishes "not yet stated" from a genuine zero.
     */
    struct ApplicationTally {
        uint256 count;
        bool recorded;
    }
    mapping(uint256 => ApplicationTally) private applicationTallies;

    // =========================================================================
    // EVENTS
    // =========================================================================

    /// @notice Emitted when a company posts a new drive.
    event DrivePosted(
        uint256 indexed driveId,
        address indexed company,
        address indexed college,
        string roleTitle,
        uint256 annualPackage,
        uint16 minCgpaScaled,
        uint16 batchYear,
        uint256 applicationDeadline,
        uint256 driveDate,
        string ipfsHash
    );

    /**
     * @notice Emitted on every lifecycle change, carrying the previous status.
     * @dev    The previous value is included for the same reason batch strength carries
     *         it: a status that only ever showed its current value could be walked
     *         backwards without the history being obvious.
     */
    event DriveStatusChanged(
        uint256 indexed driveId,
        DriveStatus previousStatus,
        DriveStatus newStatus,
        address indexed changedBy
    );

    /**
     * @notice Emitted when a company states, or restates, how many applied.
     * @dev    Carries the previous value for the same reason batch strength does: a
     *         figure that can be revised is fine, a figure that can be revised
     *         invisibly is not.
     */
    event ApplicationCountRecorded(
        uint256 indexed driveId,
        address indexed company,
        uint256 previousCount,
        uint256 newCount
    );

    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================

    constructor(address _actorRegistry) {
        if (_actorRegistry == address(0)) {
            revert InvalidRegistryAddress();
        }
        actorRegistry = ActorRegistry(_actorRegistry);
    }

    // =========================================================================
    // WRITE FUNCTIONS
    // =========================================================================

    /**
     * @notice Posts a recruitment drive. Callable only by the recruiting company itself.
     * @dev    Lands in `Proposed`: a company can say what it is offering without the
     *         college's permission, but it cannot reach that college's students until
     *         the college agrees to host it. That ordering matters — the terms are the
     *         company's alone, and the college's only power is yes or no.
     */
    function postDrive(
        address _college,
        string calldata _roleTitle,
        uint256 _annualPackage,
        uint16 _minCgpaScaled,
        uint16 _batchYear,
        uint256 _applicationDeadline,
        uint256 _driveDate,
        string calldata _ipfsHash
    ) external returns (uint256 driveId) {
        // --- CHECKS ---
        if (
            actorRegistry.getActorRole(msg.sender) != ActorRegistry.Role.Company ||
            !actorRegistry.isActive(msg.sender)
        ) {
            revert NotActiveCompany(msg.sender);
        }
        if (
            actorRegistry.getActorRole(_college) != ActorRegistry.Role.College ||
            !actorRegistry.isActive(_college)
        ) {
            revert NotActiveCollege(_college);
        }

        uint256 titleLength = bytes(_roleTitle).length;
        if (titleLength == 0 || titleLength > MAX_ROLE_TITLE_LENGTH) {
            revert InvalidRoleTitleLength(titleLength);
        }
        uint256 hashLength = bytes(_ipfsHash).length;
        if (hashLength == 0 || hashLength > MAX_IPFS_HASH_LENGTH) {
            revert InvalidIpfsHashLength(hashLength);
        }
        if (_annualPackage == 0 || _annualPackage > MAX_ANNUAL_PACKAGE) {
            revert InvalidPackage(_annualPackage);
        }
        if (_minCgpaScaled > MAX_CGPA_SCALED) {
            revert InvalidCgpa(_minCgpaScaled);
        }
        if (_batchYear < MIN_BATCH_YEAR || _batchYear > MAX_BATCH_YEAR) {
            revert InvalidBatchYear(_batchYear);
        }
        // Applications must close on or before the drive runs — a deadline after the
        // event it gates is meaningless, and almost certainly a typo.
        if (_applicationDeadline == 0 || _driveDate == 0 || _applicationDeadline > _driveDate) {
            revert InvalidDriveDates(_applicationDeadline, _driveDate);
        }

        // --- EFFECTS ---
        driveId = nextDriveId;
        unchecked { nextDriveId++; }

        drives[driveId] = Drive({
            id:                  driveId,
            company:             msg.sender,
            college:             _college,
            roleTitle:           _roleTitle,
            annualPackage:       _annualPackage,
            minCgpaScaled:       _minCgpaScaled,
            batchYear:           _batchYear,
            applicationDeadline: _applicationDeadline,
            driveDate:           _driveDate,
            ipfsHash:            _ipfsHash,
            status:              DriveStatus.Proposed,
            postedAt:            block.timestamp
        });

        emit DrivePosted(
            driveId,
            msg.sender,
            _college,
            _roleTitle,
            _annualPackage,
            _minCgpaScaled,
            _batchYear,
            _applicationDeadline,
            _driveDate,
            _ipfsHash
        );
        emit DriveStatusChanged(driveId, DriveStatus.None, DriveStatus.Proposed, msg.sender);
    }

    /**
     * @notice The college agrees to host a proposed drive, making it visible to students.
     * @dev    Only the college the drive was addressed to. Approving is the college's
     *         entire authority here — it never edits the terms it is approving.
     */
    function approveDrive(uint256 _driveId) external {
        Drive storage drive = _requireDrive(_driveId);
        if (msg.sender != drive.college) {
            revert NotAuthorizedForDrive(msg.sender, _driveId);
        }
        if (drive.status != DriveStatus.Proposed) {
            revert WrongDriveStatus(_driveId, drive.status);
        }
        _setStatus(drive, DriveStatus.Approved);
    }

    /// @notice The college declines to host a proposed drive.
    function rejectDrive(uint256 _driveId) external {
        Drive storage drive = _requireDrive(_driveId);
        if (msg.sender != drive.college) {
            revert NotAuthorizedForDrive(msg.sender, _driveId);
        }
        if (drive.status != DriveStatus.Proposed) {
            revert WrongDriveStatus(_driveId, drive.status);
        }
        _setStatus(drive, DriveStatus.Rejected);
    }

    /**
     * @notice The company closes applications on its own approved drive.
     * @dev    Closing stops new applicants; it does not end the drive. Outcomes for
     *         students already in the process are still recorded afterwards.
     */
    function closeDrive(uint256 _driveId) external {
        Drive storage drive = _requireDrive(_driveId);
        if (msg.sender != drive.company) {
            revert NotAuthorizedForDrive(msg.sender, _driveId);
        }
        if (drive.status != DriveStatus.Approved) {
            revert WrongDriveStatus(_driveId, drive.status);
        }
        _setStatus(drive, DriveStatus.Closed);
    }

    /**
     * @notice Calls off a drive after it was approved. Either party may do this.
     * @dev    Both can genuinely call off a campus drive — a company withdraws, or a
     *         college cancels the visit — so both are allowed, and the event records
     *         which one did. The record itself is never removed: "this drive was
     *         cancelled" is information a student who applied is entitled to keep.
     */
    function cancelDrive(uint256 _driveId) external {
        Drive storage drive = _requireDrive(_driveId);
        if (msg.sender != drive.company && msg.sender != drive.college) {
            revert NotAuthorizedForDrive(msg.sender, _driveId);
        }
        if (drive.status != DriveStatus.Approved && drive.status != DriveStatus.Closed) {
            revert WrongDriveStatus(_driveId, drive.status);
        }
        _setStatus(drive, DriveStatus.Cancelled);
    }

    /**
     * @notice States how many students applied to this drive. Company-only.
     * @dev    Callable once the college has agreed to host, and afterwards — the real
     *         figure is only known once applications close, which is later than
     *         approval and often later than the drive itself.
     *
     *         May be restated; a miscount is a normal thing to fix. What it cannot be
     *         is restated quietly, since the event carries the previous value. Zero is
     *         a legitimate figure — a drive nobody applied to is a real outcome — which
     *         is why the tally records whether it was stated at all.
     */
    function recordApplicationCount(uint256 _driveId, uint256 _count) external {
        Drive storage drive = _requireDrive(_driveId);
        if (msg.sender != drive.company) {
            revert NotAuthorizedForDrive(msg.sender, _driveId);
        }
        if (drive.status == DriveStatus.Proposed || drive.status == DriveStatus.Rejected) {
            revert WrongDriveStatus(_driveId, drive.status);
        }
        if (_count > MAX_APPLICATION_COUNT) {
            revert InvalidApplicationCount(_count);
        }

        ApplicationTally storage tally = applicationTallies[_driveId];
        uint256 previous = tally.recorded ? tally.count : 0;
        tally.count = _count;
        tally.recorded = true;

        emit ApplicationCountRecorded(_driveId, msg.sender, previous, _count);
    }

    // =========================================================================
    // VIEW FUNCTIONS
    // =========================================================================

    /**
     * @notice How many applied to a drive, and whether that has been stated yet.
     * @dev    `recorded` matters: a drive nobody applied to and a drive whose count
     *         has not been published both read as zero otherwise, and only one of
     *         those is a fact.
     */
    function getApplicationCount(uint256 _driveId)
        external
        view
        returns (uint256 count, bool recorded)
    {
        ApplicationTally storage tally = applicationTallies[_driveId];
        return (tally.count, tally.recorded);
    }

    /// @notice Returns a drive by id. Reverts if it was never posted.
    function getDrive(uint256 _driveId) external view returns (Drive memory) {
        if (drives[_driveId].status == DriveStatus.None) {
            revert DriveNotFound(_driveId);
        }
        return drives[_driveId];
    }

    /**
     * @notice The company that owns a drive, and whether it is currently open.
     * @dev    A single cheap call for DriveOutcomes, which has to establish both before
     *         accepting an outcome — two separate reads would cost more gas for the
     *         same answer.
     */
    function driveAuthority(uint256 _driveId)
        external
        view
        returns (address company, address college, bool acceptsOutcomes)
    {
        Drive storage drive = drives[_driveId];
        // Outcomes stay recordable once applications close: the process continues
        // after the deadline, and results arrive later than the drive date.
        bool open = drive.status == DriveStatus.Approved || drive.status == DriveStatus.Closed;
        return (drive.company, drive.college, open);
    }

    /// @notice Whether a drive exists at all.
    function driveExists(uint256 _driveId) external view returns (bool) {
        return drives[_driveId].status != DriveStatus.None;
    }

    // =========================================================================
    // INTERNAL HELPERS
    // =========================================================================

    function _requireDrive(uint256 _driveId) internal view returns (Drive storage drive) {
        drive = drives[_driveId];
        if (drive.status == DriveStatus.None) {
            revert DriveNotFound(_driveId);
        }
    }

    function _setStatus(Drive storage _drive, DriveStatus _newStatus) internal {
        DriveStatus previous = _drive.status;
        _drive.status = _newStatus;
        emit DriveStatusChanged(_drive.id, previous, _newStatus, msg.sender);
    }
}
