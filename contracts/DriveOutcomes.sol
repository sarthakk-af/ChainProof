// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ActorRegistry.sol";
import "./PlacementDrive.sol";

/**
 * @title DriveOutcomes
 * @author ChainProof Team
 * @notice What actually happened to each student in a drive, written only by the
 *         company running it — and whether the student took the offer.
 *
 * @dev The placement percentage every parent reads is
 *      derived from here, so the rules about who may write what are the point of
 *      the contract, not a detail of it:
 *
 *        - only the **company** running a drive records its stages. A college
 *          cannot mark its own students selected;
 *        - only the **student** answers an offer. A company cannot accept on
 *          their behalf and count them as placed;
 *        - a student is placed only while holding an offer they have accepted
 *          *and* that the company has not since withdrawn.
 *
 *      Nothing is deleted. Every stage is appended, so a withdrawn offer is a new
 *      record superseding an old one rather than an edit — the history stays
 *      readable, which is the whole reason for putting it on a chain.
 *
 *      Applications are deliberately absent. They are personal data, there are
 *      hundreds per drive, and the company does not author them. "How many
 *      applied" is served from the off-chain mirror; everything a company
 *      *judged* is here.
 */
contract DriveOutcomes {

    // =========================================================================
    // ENUMS & STRUCTS
    // =========================================================================

    /**
     * @notice The canonical stages of a recruitment process.
     * @dev    Fixed rather than company-defined, so that two companies' funnels can
     *         be compared — which is what makes a college-wide figure mean anything.
     *         Each record also carries the company's own label ("Technical Round 2"),
     *         so a fixed set never forces a company to misdescribe its process.
     *
     *         Begins at Shortlisted because that is the first judgement a company
     *         makes. Applying is the student's act and is not recorded here.
     */
    enum Stage {
        None,         // 0 - nothing recorded yet
        Shortlisted,  // 1 - passed initial screening
        Assessment,   // 2 - test / task round
        Interview,    // 3 - interview round
        Offered,      // 4 - offer extended
        NotSelected   // 5 - process ended without an offer, or an offer withdrawn
    }

    /// @notice A student's answer to an offer. Only the student may set it.
    enum OfferResponse {
        None,      // 0 - not answered yet
        Accepted,  // 1
        Declined   // 2
    }

    /**
     * @notice One stage recorded by a company for one student in one drive.
     * @param stage     Canonical stage reached.
     * @param label     The company's own name for this round. May be empty.
     * @param ipfsHash  Optional pointer to supporting detail. May be empty.
     * @param timestamp Block timestamp when it was recorded.
     */
    struct StageRecord {
        Stage stage;
        string label;
        string ipfsHash;
        uint256 timestamp;
    }

    // =========================================================================
    // CUSTOM ERRORS
    // =========================================================================

    /// @notice Thrown when a constructor address is the zero address.
    error InvalidAddress();

    /// @notice Thrown when the referenced drive does not exist or is not accepting outcomes.
    error DriveNotOpen(uint256 driveId);

    /// @notice Thrown when someone other than the drive's own company records an outcome.
    error NotDriveCompany(address caller, uint256 driveId);

    /// @notice Thrown when the subject of an outcome is not a registered Student.
    error NotAStudent(address subject);

    /// @notice Thrown when `Stage.None` is passed as a real stage.
    error InvalidStage();

    /// @notice Thrown when recording a stage identical to the one already current.
    error StageUnchanged(uint256 driveId, address student, Stage stage);

    /// @notice Thrown when `_label` exceeds `MAX_LABEL_LENGTH` bytes.
    error LabelTooLong(uint256 length);

    /// @notice Thrown when `_ipfsHash` exceeds `MAX_IPFS_HASH_LENGTH` bytes.
    error IpfsHashTooLong(uint256 length);

    /// @notice Thrown when answering an offer that was never made, or no longer stands.
    error NoStandingOffer(uint256 driveId, address student);

    /// @notice Thrown when a student tries to answer the same offer twice.
    error OfferAlreadyAnswered(uint256 driveId, address student, OfferResponse response);

    /// @notice Thrown when `OfferResponse.None` is passed as an answer.
    error InvalidOfferResponse();

    // =========================================================================
    // CONSTANTS
    // =========================================================================

    /// @notice Bounds on the strings stored here permanently. See PlacementDrive for why.
    uint256 public constant MAX_LABEL_LENGTH = 60;
    uint256 public constant MAX_IPFS_HASH_LENGTH = 200;

    // =========================================================================
    // STATE VARIABLES
    // =========================================================================

    ActorRegistry public immutable actorRegistry;
    PlacementDrive public immutable placementDrive;

    /// @notice Full append-only history per drive, per student.
    mapping(uint256 => mapping(address => StageRecord[])) private history;

    /// @notice The stage currently standing for a student in a drive.
    mapping(uint256 => mapping(address => Stage)) public currentStage;

    /// @notice The student's answer to that drive's offer, if one was made.
    mapping(uint256 => mapping(address => OfferResponse)) public offerResponse;

    /**
     * @notice How many offers a student currently holds that they accepted and that
     *         still stand.
     * @dev    A counter rather than a boolean because a student may hold offers from
     *         several drives, and an offer can be withdrawn later. Placement is
     *         derived from this, so it must fall as well as rise.
     */
    mapping(address => uint256) public standingAcceptedOffers;

    /// @notice Whether a student currently counts as placed.
    mapping(address => bool) public isPlaced;

    /**
     * @notice Placed students per college, per graduating year.
     * @dev    The batch year comes from the *drive*, not from the student's profile —
     *         profiles are off-chain, and a drive already states which cohort it is
     *         open to. Course-level splits are a presentation concern for the mirror;
     *         what has to be tamper-evident is the college-wide figure per year.
     */
    mapping(address => mapping(uint16 => uint256)) public placedCount;

    /// @notice Where a placed student was counted, so the count can be undone correctly.
    mapping(address => address) private placedUnderCollege;
    mapping(address => uint16) private placedUnderBatchYear;

    // =========================================================================
    // EVENTS
    // =========================================================================

    /// @notice Emitted for every stage a company records. Carries the previous stage.
    event StageRecorded(
        uint256 indexed driveId,
        address indexed student,
        address indexed company,
        Stage previousStage,
        Stage newStage,
        string label,
        string ipfsHash,
        uint256 timestamp
    );

    /// @notice Emitted when a student answers an offer.
    event OfferAnswered(
        uint256 indexed driveId,
        address indexed student,
        OfferResponse response,
        uint256 timestamp
    );

    /// @notice Emitted whenever a student's placed status changes, either direction.
    event PlacementChanged(
        address indexed student,
        address indexed college,
        uint16 indexed batchYear,
        bool placed,
        uint256 placedTotalForBatch
    );

    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================

    constructor(address _actorRegistry, address _placementDrive) {
        if (_actorRegistry == address(0) || _placementDrive == address(0)) {
            revert InvalidAddress();
        }
        actorRegistry = ActorRegistry(_actorRegistry);
        placementDrive = PlacementDrive(_placementDrive);
    }

    // =========================================================================
    // WRITE FUNCTIONS
    // =========================================================================

    /**
     * @notice Records a stage for one student in one drive. Company-only.
     * @dev    Stages are not forced to move forward. A real process ends at different
     *         points for different people, and an offer can be withdrawn weeks later —
     *         constraining the order would only force companies to record something
     *         untrue. What is constrained is *who* may write, and that the previous
     *         value is always visible.
     */
    function recordStage(
        uint256 _driveId,
        address _student,
        Stage _stage,
        string calldata _label,
        string calldata _ipfsHash
    ) external {
        // --- CHECKS ---
        if (_stage == Stage.None) revert InvalidStage();

        (address company, address college, bool acceptsOutcomes) =
            placementDrive.driveAuthority(_driveId);
        if (!acceptsOutcomes) revert DriveNotOpen(_driveId);
        if (msg.sender != company) revert NotDriveCompany(msg.sender, _driveId);

        if (actorRegistry.getActorRole(_student) != ActorRegistry.Role.Student) {
            revert NotAStudent(_student);
        }

        uint256 labelLength = bytes(_label).length;
        if (labelLength > MAX_LABEL_LENGTH) revert LabelTooLong(labelLength);
        uint256 hashLength = bytes(_ipfsHash).length;
        if (hashLength > MAX_IPFS_HASH_LENGTH) revert IpfsHashTooLong(hashLength);

        Stage previous = currentStage[_driveId][_student];
        if (previous == _stage) revert StageUnchanged(_driveId, _student, _stage);

        // --- EFFECTS ---
        history[_driveId][_student].push(
            StageRecord({
                stage: _stage,
                label: _label,
                ipfsHash: _ipfsHash,
                timestamp: block.timestamp
            })
        );
        currentStage[_driveId][_student] = _stage;

        emit StageRecorded(
            _driveId,
            _student,
            msg.sender,
            previous,
            _stage,
            _label,
            _ipfsHash,
            block.timestamp
        );

        // An accepted offer that no longer stands stops counting. This is the
        // rescinded-offer case: the student does not silently remain "placed"
        // because a number somewhere was only ever incremented.
        if (
            previous == Stage.Offered &&
            _stage != Stage.Offered &&
            offerResponse[_driveId][_student] == OfferResponse.Accepted
        ) {
            _releaseAcceptedOffer(_student, college);
        }
    }

    /**
     * @notice A student accepts or declines an offer made to them. Student-only.
     * @dev    Only the student. A company recording "accepted" on someone's behalf
     *         would let it count a placement the student never agreed to, which is
     *         precisely the kind of number this platform exists to make unforgeable.
     */
    function answerOffer(uint256 _driveId, OfferResponse _response) external {
        if (_response == OfferResponse.None) revert InvalidOfferResponse();

        if (currentStage[_driveId][msg.sender] != Stage.Offered) {
            revert NoStandingOffer(_driveId, msg.sender);
        }

        OfferResponse existing = offerResponse[_driveId][msg.sender];
        if (existing != OfferResponse.None) {
            revert OfferAlreadyAnswered(_driveId, msg.sender, existing);
        }

        offerResponse[_driveId][msg.sender] = _response;
        emit OfferAnswered(_driveId, msg.sender, _response, block.timestamp);

        if (_response == OfferResponse.Accepted) {
            (, address college, ) = placementDrive.driveAuthority(_driveId);
            uint16 batchYear = _driveBatchYear(_driveId);
            _claimAcceptedOffer(msg.sender, college, batchYear);
        }
    }

    // =========================================================================
    // VIEW FUNCTIONS
    // =========================================================================

    /// @notice Every stage recorded for a student in a drive, oldest first.
    function getHistory(uint256 _driveId, address _student)
        external
        view
        returns (StageRecord[] memory)
    {
        return history[_driveId][_student];
    }

    /// @notice How many stages have been recorded for a student in a drive.
    function getHistoryLength(uint256 _driveId, address _student) external view returns (uint256) {
        return history[_driveId][_student].length;
    }

    /**
     * @notice Placed students against a cohort's declared size.
     * @dev    The denominator is read straight from ActorRegistry, where the college
     *         recorded it — deliberately not stored here, so there is exactly one
     *         on-chain source for it and no chance of two drifting apart.
     * @return placed   Students placed in this college and year.
     * @return declared The cohort size the college declared for this course and year.
     */
    function placementFor(address _college, string calldata _courseCode, uint16 _batchYear)
        external
        view
        returns (uint256 placed, uint256 declared)
    {
        placed = placedCount[_college][_batchYear];
        ActorRegistry.Batch memory batch = actorRegistry.getBatch(_college, _courseCode, _batchYear);
        declared = batch.strength;
    }

    // =========================================================================
    // INTERNAL HELPERS
    // =========================================================================

    function _driveBatchYear(uint256 _driveId) internal view returns (uint16) {
        return placementDrive.getDrive(_driveId).batchYear;
    }

    /// @notice Counts a newly accepted offer, flipping placement if it is the first.
    function _claimAcceptedOffer(address _student, address _college, uint16 _batchYear) internal {
        unchecked { standingAcceptedOffers[_student]++; }
        if (isPlaced[_student]) return;

        isPlaced[_student] = true;
        placedUnderCollege[_student] = _college;
        placedUnderBatchYear[_student] = _batchYear;
        unchecked { placedCount[_college][_batchYear]++; }

        emit PlacementChanged(_student, _college, _batchYear, true, placedCount[_college][_batchYear]);
    }

    /**
     * @notice Releases an accepted offer that no longer stands.
     * @dev    Decrements against the cohort the student was originally counted under,
     *         not the one implied by whichever drive triggered this. A student can
     *         hold offers from drives aimed at different years, and undoing a count
     *         somewhere it was never made would corrupt both totals.
     */
    function _releaseAcceptedOffer(address _student, address /* _college */) internal {
        if (standingAcceptedOffers[_student] > 0) {
            unchecked { standingAcceptedOffers[_student]--; }
        }
        if (standingAcceptedOffers[_student] > 0 || !isPlaced[_student]) return;

        address college = placedUnderCollege[_student];
        uint16 batchYear = placedUnderBatchYear[_student];

        isPlaced[_student] = false;
        if (placedCount[college][batchYear] > 0) {
            unchecked { placedCount[college][batchYear]--; }
        }
        delete placedUnderCollege[_student];
        delete placedUnderBatchYear[_student];

        emit PlacementChanged(_student, college, batchYear, false, placedCount[college][batchYear]);
    }
}
