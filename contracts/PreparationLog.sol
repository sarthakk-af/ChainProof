// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ActorRegistry.sol";

/**
 * @title PreparationLog
 * @author ChainProof Team
 * @notice The college's own permanent record of what it did to prepare students for
 *         placement: aptitude training, mock interviews, resume workshops, seminars.
 *
 * @dev Why this exists at all.
 *
 *      Every other contract here holds the college to account for *results* — how many
 *      students it declared, which companies it admitted, who ended up placed. None of
 *      them says anything about *effort*, and effort is the half a student or parent
 *      actually experiences. A college with a poor placement year can currently point
 *      at a slow market and there is nothing in the record to check that against. A
 *      college that ran twenty mock interviews has no way to show it either.
 *
 *      So this is the one contract where the college is the author rather than the
 *      subject. That is a deliberate asymmetry, and it comes with the obvious caveat:
 *      nothing here proves an event was any good, only that the college committed to
 *      the claim at the time and cannot revise it later. The value is in the "cannot
 *      revise it later". Twelve events recorded across the year as they happened is a
 *      different kind of statement from twelve remembered in June.
 *
 *      Records are append-only. An event that was entered in error or called off is
 *      `cancel`led, which leaves both the original entry and the cancellation visible —
 *      the same reasoning as a Cancelled drive in PlacementDrive. Nothing is deleted,
 *      because a record you can quietly remove is not a record.
 */
contract PreparationLog {

    // =========================================================================
    // ENUMS & STRUCTS
    // =========================================================================

    /**
     * @notice What kind of preparation this was.
     * @dev    A fixed set so the public page can group and count them. `Other` exists so
     *         an unanticipated activity is recorded honestly rather than mislabelled as
     *         the nearest fit — the free-text title carries the specifics.
     */
    enum EventKind {
        None,           // 0 - never stored
        Training,       // 1 - aptitude, technical or soft-skills training
        MockInterview,  // 2 - practice interviews
        Workshop,       // 3 - resume clinics, group discussion practice
        Seminar,        // 4 - talks, industry sessions, alumni interactions
        Other           // 5 - anything the four above would misdescribe
    }

    /**
     * @notice One preparation activity, as the college recorded it.
     * @param id           Globally unique, auto-incrementing identifier.
     * @param college      The college that ran it. Sole author.
     * @param kind         Which category it falls under.
     * @param title        What it was, e.g. "Aptitude Test Series - Round 3".
     * @param conductedBy  Who ran it — a trainer, a department, an outside firm.
     * @param heldOn       Unix timestamp of the day it happened.
     * @param attendance   How many students attended.
     * @param batchYear    Cohort it was aimed at, or 0 for "open to all".
     * @param ipfsHash     Optional pointer to a report, photos or attendance sheet.
     * @param cancelled    True once the college states it did not in fact happen.
     * @param recordedAt   Block timestamp when it was written. The honest part: it
     *                     shows whether the record was kept as the year went, or
     *                     assembled afterwards.
     */
    struct PreparationEvent {
        uint256 id;
        address college;
        EventKind kind;
        string title;
        string conductedBy;
        uint64 heldOn;
        uint32 attendance;
        uint16 batchYear;
        string ipfsHash;
        bool cancelled;
        uint256 recordedAt;
    }

    // =========================================================================
    // CUSTOM ERRORS
    // =========================================================================

    /// @notice Thrown when the registry address provided is the zero address.
    error InvalidRegistryAddress();

    /// @notice Thrown when a non-College, or an unapproved College, tries to record an event.
    error NotActiveCollege(address caller);

    /// @notice Thrown when the referenced event does not exist.
    error EventNotFound(uint256 eventId);

    /// @notice Thrown when an address other than the authoring college tries to act on an event.
    error NotEventAuthor(address caller, uint256 eventId);

    /// @notice Thrown when cancelling an event that is already cancelled.
    error EventAlreadyCancelled(uint256 eventId);

    /// @notice Thrown when `kind` is `None` or outside the enum.
    error InvalidEventKind(uint8 kindValue);

    /// @notice Thrown when `_title` is empty or longer than `MAX_TITLE_LENGTH` bytes.
    error InvalidTitleLength(uint256 length);

    /// @notice Thrown when `_conductedBy` is empty or longer than `MAX_CONDUCTED_BY_LENGTH` bytes.
    error InvalidConductedByLength(uint256 length);

    /// @notice Thrown when `_ipfsHash` is longer than `MAX_IPFS_HASH_LENGTH` bytes.
    error IpfsHashTooLong(uint256 length);

    /// @notice Thrown when `_reason` is longer than `MAX_REASON_LENGTH` bytes.
    error ReasonTooLong(uint256 length);

    /// @notice Thrown when the date given is zero or implausibly far in the future.
    error InvalidHeldOnDate(uint64 heldOn);

    /// @notice Thrown when attendance exceeds `MAX_ATTENDANCE`.
    error InvalidAttendance(uint32 attendance);

    /// @notice Thrown when a batch year is neither 0 nor inside the plausible range.
    error InvalidBatchYear(uint16 batchYear);

    // =========================================================================
    // CONSTANTS
    // =========================================================================

    /**
     * @notice Bounds on everything stored permanently here.
     * @dev    The backend enforces the same limits, but anyone can call this contract
     *         directly, so they have to exist here too — otherwise "validated" only
     *         means "validated if you used our frontend". Byte lengths, not character
     *         counts: a title in a multi-byte script is roughly three bytes a character.
     */
    uint256 public constant MAX_TITLE_LENGTH = 120;
    uint256 public constant MAX_CONDUCTED_BY_LENGTH = 100;
    uint256 public constant MAX_IPFS_HASH_LENGTH = 200;
    uint256 public constant MAX_REASON_LENGTH = 200;

    /// @notice Larger than any single college's student body, but a finite ceiling.
    uint32 public constant MAX_ATTENDANCE = 100000;

    /// @notice How far ahead an event may be dated. A college may record a session it has
    ///         scheduled, but a date years out is a typo, not a plan.
    uint64 public constant MAX_FUTURE_WINDOW = 365 days;

    uint16 public constant MIN_BATCH_YEAR = 2000;
    uint16 public constant MAX_BATCH_YEAR = 2100;

    // =========================================================================
    // STATE VARIABLES
    // =========================================================================

    /// @notice Reference to ActorRegistry for cross-contract role checks.
    /// @dev Set immutably at deployment; `immutable` saves ~2100 gas per read over storage.
    ActorRegistry public immutable actorRegistry;

    /// @notice Every event ever recorded, by id. Append-only.
    mapping(uint256 => PreparationEvent) private events;

    /// @notice Auto-incrementing counter for globally unique event ids.
    uint256 public nextEventId;

    /// @notice Ids recorded by each college, in the order they were written.
    mapping(address => uint256[]) private eventsByCollege;

    /**
     * @notice How many events a college has standing (recorded, not cancelled).
     * @dev    Kept as a counter so the public page can show a figure without walking
     *         the whole array, and decremented on cancellation so a college cannot
     *         inflate the count by recording and then calling off.
     */
    mapping(address => uint256) public standingEventCount;

    // =========================================================================
    // EVENTS
    // =========================================================================

    /// @notice Emitted when a college records a preparation activity.
    event PreparationRecorded(
        uint256 indexed eventId,
        address indexed college,
        EventKind indexed kind,
        string title,
        uint64 heldOn,
        uint32 attendance,
        uint16 batchYear
    );

    /// @notice Emitted when a college states a recorded activity did not happen.
    /// @dev    The original entry is never removed; this sits beside it.
    event PreparationCancelled(uint256 indexed eventId, address indexed college, string reason);

    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================

    constructor(address _actorRegistry) {
        if (_actorRegistry == address(0)) revert InvalidRegistryAddress();
        actorRegistry = ActorRegistry(_actorRegistry);
    }

    // =========================================================================
    // WRITES
    // =========================================================================

    /**
     * @notice Records one preparation activity.
     * @dev    College-only, and only once Active. Note what this contract does not
     *         have: any way for the college to edit an entry afterwards. That is the
     *         entire point — a record of effort that can be topped up in June is not
     *         evidence of anything.
     * @param _kind        Category of activity.
     * @param _title       What it was.
     * @param _conductedBy Who ran it.
     * @param _heldOn      Unix timestamp of the day it happened.
     * @param _attendance  Students who attended.
     * @param _batchYear   Cohort it targeted, or 0 for open to all.
     * @param _ipfsHash    Optional pointer to a report or attendance sheet; may be empty.
     * @return eventId     The id assigned to this record.
     */
    function recordEvent(
        EventKind _kind,
        string calldata _title,
        string calldata _conductedBy,
        uint64 _heldOn,
        uint32 _attendance,
        uint16 _batchYear,
        string calldata _ipfsHash
    ) external returns (uint256 eventId) {
        if (!actorRegistry.isActive(msg.sender)) revert NotActiveCollege(msg.sender);
        if (actorRegistry.getActorRole(msg.sender) != ActorRegistry.Role.College) {
            revert NotActiveCollege(msg.sender);
        }
        if (_kind == EventKind.None) revert InvalidEventKind(uint8(_kind));

        uint256 titleLength = bytes(_title).length;
        if (titleLength == 0 || titleLength > MAX_TITLE_LENGTH) {
            revert InvalidTitleLength(titleLength);
        }
        uint256 conductedByLength = bytes(_conductedBy).length;
        if (conductedByLength == 0 || conductedByLength > MAX_CONDUCTED_BY_LENGTH) {
            revert InvalidConductedByLength(conductedByLength);
        }
        if (bytes(_ipfsHash).length > MAX_IPFS_HASH_LENGTH) {
            revert IpfsHashTooLong(bytes(_ipfsHash).length);
        }
        if (_heldOn == 0 || _heldOn > block.timestamp + MAX_FUTURE_WINDOW) {
            revert InvalidHeldOnDate(_heldOn);
        }
        if (_attendance > MAX_ATTENDANCE) revert InvalidAttendance(_attendance);
        if (_batchYear != 0 && (_batchYear < MIN_BATCH_YEAR || _batchYear > MAX_BATCH_YEAR)) {
            revert InvalidBatchYear(_batchYear);
        }

        eventId = nextEventId++;
        events[eventId] = PreparationEvent({
            id: eventId,
            college: msg.sender,
            kind: _kind,
            title: _title,
            conductedBy: _conductedBy,
            heldOn: _heldOn,
            attendance: _attendance,
            batchYear: _batchYear,
            ipfsHash: _ipfsHash,
            cancelled: false,
            recordedAt: block.timestamp
        });
        eventsByCollege[msg.sender].push(eventId);
        unchecked { standingEventCount[msg.sender]++; }

        emit PreparationRecorded(eventId, msg.sender, _kind, _title, _heldOn, _attendance, _batchYear);
    }

    /**
     * @notice States that a recorded activity did not, in fact, happen.
     * @dev    The only way back from a wrong entry, and it costs the college something:
     *         the original stays on the record beside the cancellation, so a pattern of
     *         recording and calling off is as visible as the events themselves.
     * @param _eventId The event to cancel.
     * @param _reason  Short, public statement of why.
     */
    function cancelEvent(uint256 _eventId, string calldata _reason) external {
        PreparationEvent storage e = events[_eventId];
        if (e.college == address(0)) revert EventNotFound(_eventId);
        if (e.college != msg.sender) revert NotEventAuthor(msg.sender, _eventId);
        if (e.cancelled) revert EventAlreadyCancelled(_eventId);
        if (bytes(_reason).length > MAX_REASON_LENGTH) {
            revert ReasonTooLong(bytes(_reason).length);
        }

        e.cancelled = true;
        unchecked { standingEventCount[msg.sender]--; }

        emit PreparationCancelled(_eventId, msg.sender, _reason);
    }

    // =========================================================================
    // VIEWS
    // =========================================================================

    /// @notice Returns one recorded event.
    /// @dev    Not named `getEvent`: ethers.js reserves that on every contract object
    ///         for looking up event fragments, so a Solidity function of that name is
    ///         shadowed and unreachable from the client.
    function getPreparationEvent(uint256 _eventId) external view returns (PreparationEvent memory) {
        PreparationEvent memory e = events[_eventId];
        if (e.college == address(0)) revert EventNotFound(_eventId);
        return e;
    }

    /// @notice Returns every event id a college has recorded, cancelled ones included.
    function getCollegeEventIds(address _college) external view returns (uint256[] memory) {
        return eventsByCollege[_college];
    }

    /// @notice How many events a college has recorded in total, cancelled ones included.
    function collegeEventCount(address _college) external view returns (uint256) {
        return eventsByCollege[_college].length;
    }
}
