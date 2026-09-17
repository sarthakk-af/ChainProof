# ChainProof — Technical Report

How ChainProof works under the hood, written so every part can be explained confidently in a viva. For the plain-language version, see [TEACHER_OVERVIEW.md](TEACHER_OVERVIEW.md). For the design decisions and the reasoning behind them, see [SPEC.md](SPEC.md).

---

## 1. The shape of the system

```
Browser (React)  →  Backend (Node/Express + SQLite)  →  Blockchain (Solidity)
   frontend/                 backend/                       contracts/
```

| Layer | Holds | Can it be changed? |
|---|---|---|
| **Blockchain** | The record of the placement season: who is registered, cohort sizes, drives and their terms, each candidate's stages, offer answers, placements, training sessions, suspensions | Never — only added to |
| **Backend database** | Everything about people: logins, names, roll numbers, CGPA, resumes, skills, applications, placement notices. Plus a fast copy of the chain records | Yes |
| **Frontend** | Nothing. It only talks to the backend over HTTP | — |

The split is the core design decision: **on-chain is the record of events; off-chain is people.**

A resume changes constantly, and a student's name written to a public chain could never be erased. A placement record, on the other hand, is only worth anything *because* it can't be changed. So each kind of data lives where its properties are useful.

**Why a backend at all?** A blockchain needs a wallet, a private key and gas for every action. Asking a student or a placement officer to manage that is unreasonable. The backend hides it, while every meaningful action still ends up on the chain, signed by the person who took it.

---

## 2. The smart contracts (`contracts/`)

Four contracts, deployed once. Their code never changes; only their data grows. Every one follows the same rules:
- custom errors instead of revert strings, which is cheaper;
- checks, then effects, then interactions (CEI) ordering;
- `immutable` references between contracts;
- byte-length limits on every stored string.

The byte limits are measured in bytes, not characters, because a name in Devanagari uses about 3 bytes per character.

### The principle every contract enforces

**Whoever would be embarrassed by a lie is the one who has to sign it.**

| Fact | Signed by | Contract |
|---|---|---|
| Batch size (the denominator) | College | `ActorRegistry` |
| Which companies may recruit | College | `ActorRegistry` |
| Drive terms (role, package, cutoff, dates) | Company | `PlacementDrive` |
| Whether a drive may run on campus | College | `PlacementDrive` |
| How many applied | Company | `PlacementDrive` |
| Each candidate's stage, offers, withdrawals | Company | `DriveOutcomes` |
| Accepting or declining an offer | Student | `DriveOutcomes` |
| Training and mock-interview sessions | College | `PreparationLog` |
| Suspending or restoring an account | Administrator (verifier) | `ActorRegistry` |

The contracts decide purely from `msg.sender` — the wallet that signed the transaction. There are no usernames on-chain.

### `ActorRegistry.sol` — who is who

- Each address has one record: a `role` (Student / College / Company) and a `status` (Pending / Active / Rejected / Suspended).
- **Admission is split by who has the authority to decide** (`_checkMayDecide`). The platform `verifier` admits a College. An Active College admits the Companies that recruit on its campus. Nobody admits their own kind.
- **Students are Active on registration.** A contract can't check a roll number, so the backend only submits a student's registration after matching them against the college's roster. Students are registered under the placeholder name `"Student"`, so a real name never reaches the public chain.
- **Rejection isn't permanent.** A rejected address can register again. `rejectionCount` is carried over, so the earlier rejection is never hidden.
- **Suspension** (`suspendActor` / `reinstateActor`) is the administrator's only power over another account. It flips `Active ↔ Suspended` and records the reason in an event. It changes nothing the account already signed. And a suspended address cannot register again to escape it.
- **Batch sizes** (`recordBatchStrength`) are stored per college, course and year. Each change emits `BatchStrengthRecorded` with **both the old and the new value**, so shrinking the denominator is always visible.

### `PlacementDrive.sol` — what a company came to offer

- `postDrive` (company only): role, annual package, minimum CGPA (stored ×100 so comparisons are exact), batch year, deadline, drive date, and an IPFS hash of the full job description. The drive starts `Proposed`.
- The college calls `approveDrive` or `rejectDrive`. Either side may `cancelDrive`. The company may `closeDrive`.
- **No function edits a drive's terms.** A test fails if the contract ever gains a function named like an editor (`edit…`, `update…`, `set…`, `amend…`, `revise…`). The cutoff is published before applications open, so it can't be tightened afterwards to justify a rejection.
- `recordApplicationCount` lets the company publish how many applied. Individual applications stay off-chain (personal data, hundreds per drive); only the total is public. The company signs it because the college's conversion rate depends on it.
- Nothing is deleted. A cancelled drive stays visible.

### `DriveOutcomes.sol` — what happened, and who is placed

- `recordStage` (only the company that owns the drive) appends one of Shortlisted / Assessment / Interview / Offered / NotSelected, plus the company's own label (e.g. "Tech Round 2"). History is append-only, and the same stage can't be recorded twice in a row.
- `answerOffer` (only the student, and only while an offer stands): Accepted or Declined, answered once.

**How the placed count stays correct.** This is the mechanism to be able to explain.

- **Accepting** increments `standingAcceptedOffers[student]`. The first time a student has one, they're marked placed, and `placedCount[college][batchYear]` goes up.
- **Withdrawing an accepted offer** (the company records a later stage) decrements that counter. The student is un-placed only when it reaches zero. So someone holding two accepted offers stays placed if one is withdrawn.
- **Un-placing uses the cohort the student was originally counted in** (`placedUnderCollege`, `placedUnderBatchYear`). The count always falls in the same place it rose.
- **Every change emits `PlacementChanged`** with the new total, so the backend mirrors the contract's own answer rather than recomputing it.

### `PreparationLog.sol` — what the college did to prepare students

- `recordEvent` (Active College only): kind (Training / Mock interview / Workshop / Seminar / Other), title, who ran it, date held, attendance, batch (0 means all batches), and an optional document hash. It also stores `recordedAt`, the block timestamp. That timestamp is what separates a log kept as the year went from one put together at the end.
- **There is no edit function.** `cancelEvent` marks a session as not having happened. The original stays visible, `standingEventCount` goes down, and the reason is emitted.
- The date can be at most a year ahead: a college may record a scheduled session, but a date years away is a typo.
- This is the one contract where the college writes about itself. Everywhere else it is held to account for *results*; this holds it to account for *effort*.

### Compiler

Solidity 0.8.20 with the optimiser on at 200 runs — the usual middle ground for contracts deployed once but called often.

### Contract tests — 213

| File | Tests | Covers |
|---|---|---|
| `ActorRegistry.test.js` | 72 | roles, split admission, resubmission, suspension, batch sizes, byte limits |
| `PlacementDrive.test.js` | 54 | who may post, approve, cancel; terms can't be edited; applicant count |
| `DriveOutcomes.test.js` | 42 | company-only stages, student-only answers, placement up and down, two-offer case |
| `PreparationLog.test.js` | 28 | college-only authorship, bounds, no edits, cancellation, counting |
| `v2-integration.test.js` | 17 | a full season across all contracts |

---

## 3. The backend (`backend/`)

### Custodial wallets (`wallets.js`, `crypto.js`, `treasury.js`)

- At signup the backend generates a wallet, encrypts its private key (AES-256-GCM), and stores it. The key is decrypted only for the moment a transaction is signed.
- A **treasury** wallet sends each new wallet a little gas. When the treasury runs low, signup says so clearly rather than failing vaguely.

### Transaction queue (`txQueue.js`)

A wallet's transactions must use consecutive numbers (nonces). Wallets are rebuilt from storage on every request, so the queue keeps its own counter per address and sends one transaction per address at a time.

- **Why the counter is kept locally:** a local blockchain reports a stale nonce if you ask it right after a transaction.
- **Stale counters are retried once.** If another process sent from the same wallet (e.g. the seed script using the treasury), the chain rejects the nonce. The queue re-reads it and retries. This is safe because a rejected nonce means the transaction was never accepted.
- **Every signer goes through this queue,** including the administrator's `verifier`.

### Authentication (`auth.js`, `middleware/`)

- Email and password; passwords are hashed with bcrypt.
- The login returns a signed token (JWT) carrying a `token_version`. Logging out or resetting the password bumps it, which kills every older token.
- **Admin tokens are a different type.** Each auth check refuses the other type, so an admin session can't be used as a user session, or the other way round.
- The admin login is created from `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `.env`, and its password is re-synced on every start.

### Student verification (`studentVerification.js`)

A student is verified when **two** things are true, in either order:
1. their email is confirmed (a 6-digit code sent via Brevo), and
2. their roll number matches the college's roster — automatically if it's already uploaded, otherwise approved by the placement cell from a queue.

Whichever happens second triggers `tryComplete`, the only place a student is written on-chain. Until then they can browse but not act, and they appear in no figure.

Writing on-chain *last* means a sign-up that never comes back costs no gas and never inflates the "registered students" number. If the chain write fails, re-entering the roll number retries it.

### Resumes, directory and talent pool

- **Profile fields are declared once** in `studentProfile.js`. The database columns, validation, the profile form and the roster upload are all generated from that list, so adding a field is one edit.
- **Resume entries** (`resume.js`): projects, experience, education, certifications, achievements. They're self-claimed and unverified by design. Links must be `http`/`https`, which blocks `javascript:` links.
- **Skills** are stored normalised ("React.js" and "react js" match) but displayed as typed.
- **Talent pool** (`routes/talent.js`, company only): filter by course, batch, CGPA, skills (all must match) and placed status.
  - The database query never selects name, email or phone, so a serializer can't leak them by mistake.
  - Contact details unlock for one student and one company when that student applies to that company's drive.
- **Classmate lookup** (`routes/directory.js`, verified students only) needs both roll number and email. It's limited to 20 lookups per 15 minutes, and a miss gives the same answer whether the roll number or the email was wrong.

### Placement notices (`routes/announcements.js`)

- The only editable content on the platform.
- The college may post; a company may post only about its own drive.
- Edits are stamped as edited. A deleted notice is marked withdrawn rather than removed from the table.
- Notices marked public appear on the public dashboard.

### The event indexer (`indexer.js`, `db/`)

A background process copies every relevant chain event into SQLite:

| Contract | Events |
|---|---|
| `ActorRegistry` | registered, approved, rejected, suspended, reinstated, batch size |
| `PlacementDrive` | drive posted, status changed, application count |
| `DriveOutcomes` | stage recorded, offer answered, placement changed |
| `PreparationLog` | recorded, cancelled |

How it stays correct:
- **Catch-up and live sync.** On start it catches up from its last position, then listens live. Every 60 seconds it re-checks, in case a listener silently stopped.
- **A failed event holds the position back.** The saved position never moves past it, so it's retried instead of lost.
- **Every write can be repeated safely.** Each event arrives twice in normal use — once when a route processes its own receipt, once from the listener. The batch table only counts a *newer* event with a *different* size as a revision; this fixed a bug where the public page showed batches as "revised" when they never were.
- **Redeploying resets the copy.** A fresh chain is detected by its deploy timestamp. The copied chain data is cleared, and so are the rows that only made sense on the old chain (student verifications, roster claims, notices). Logins are kept.
- **The copy can be rebuilt.** If its tables were deleted, restarting would rebuild them from the chain.

### Other safeguards

- **Idempotency keys** on posting a drive and recording a stage: a retried request can't create a duplicate. A key reused with a *different* request is refused, rather than silently returning the earlier result.
- **Rate limits** by user: registration, results, drives, preparation records, and login/signup.
- **Clean errors:** malformed JSON gets a 400, not a crash or a 500.
- **Startup takes the port first.** If port 4000 is taken, the backend exits with a clear message *before* touching the database. Previously, a second copy reset the shared database and then kept running in the background.
- **Production guard:** the backend refuses to run against a non-local chain with the known Hardhat development keys.

### Routes

| Prefix | Who | What |
|---|---|---|
| `/auth` | anyone | sign up, confirm email, log in/out, password reset |
| `/me` | signed in | own profile, claim roll number, resume, skills, register a company |
| `/students` | verified students | classmate lookup |
| `/talent` | approved companies | anonymous talent pool |
| `/drives` | signed in | post, apply, applicants, application count |
| `/outcomes` | signed in | record a stage, answer an offer |
| `/announcements` | signed in | placement notices |
| `/college` | the college | roster, verification queue, batch sizes, companies, drives, preparation |
| `/admin` | administrator | create the college, accounts, suspend/restore, action log |
| `/public` | anyone | batches, drives and funnels, recruiters, preparation, public notices |

### Backend tests — 177

These run against a temporary SQLite file with no blockchain. They cover validation, authorisation, the privacy boundaries (a company never sees names; one company's applicant doesn't unlock for another), notices, resumes, preparation counting, batch-revision counting, verification ordering, idempotency and the indexer's position handling.

Paths that actually send transactions are covered by the live suites below instead.

### Live suites — `npm run test:attacks`

- **`v2-journey.mjs`** runs a whole season against the running stack: the admin creates the college; the college loads the roster; students verify both ways; a company is admitted, posts a drive and runs its funnel; offers are answered and withdrawn; the batch size is revised. It then checks preparation, resumes, the talent pool, notices and suspension. Throughout, it confirms nobody can write another party's facts, and that no real name reaches the chain.
- **`hostile-input.mjs`** sends forged tokens, injection attempts, wrong types, prototype pollution, malformed bodies and oversized requests (134 checks).
- **`ui-contract.mjs`** checks that every field the dashboards read is actually returned. On its first run it found a real bug: a re-verified student was vanishing from the talent pool.

---

## 4. The frontend (`frontend/`)

- **Routing without a library.** `App.jsx` checks the path for a few fixed pages (`/admin`, `/public`, `/about`, `/privacy`, `/profile`, `/reset-password`). Otherwise it picks a screen from the session:
  - not signed in → landing page
  - no role yet → registration
  - company awaiting approval → pending screen
  - suspended → suspended screen
  - otherwise → the role's dashboard
- **Session state** (`AuthContext.jsx`) holds the user, their on-chain record, their profile, and a `verification` summary that lists exactly what is still missing. So the interface always says what to do next rather than showing a disabled button.
- **Screens:**

| Role | Tabs |
|---|---|
| Student | open drives, applications, notices, profile, resume, find a classmate |
| College | verification queue, companies, drives, roster, cohorts, preparation, notices |
| Company | its drives, the talent pool, notices |
| Admin | health, create college, accounts, action log |

- **Public dashboard:** a batch switcher; four headline figures (placed out of the declared batch, companies, highest and median package, preparation); a warning if the batch size was revised; and tabs for companies (one row per drive, expandable), preparation, notices, and "how to read this". The batch and tab are kept in the URL. Called-off drives are excluded from the headline figures.
- **Design system** (`index.css`): every colour, font and spacing value is a CSS variable, which is what makes the light/dark switch work. Layouts adapt down to phone width.
- **Lint:** ESLint is configured and passes.

---

## 5. A request, end to end — a student accepts an offer

1. The student clicks **Accept** (`StudentDashboard.jsx`). The frontend sends `POST /outcomes/:driveId/answer` with the student's token. No idempotency key is needed: the contract refuses a second answer to the same offer.
2. The backend checks the token and that the caller is an Active student. It then takes the student's wallet lock, decrypts the key, and calls `answerOffer(driveId, Accepted)`, signed by the **student's own wallet**.
3. The contract checks an offer is standing and not already answered, records the answer, and, if this is the student's first accepted offer, marks them placed and increments `placedCount`. It emits `OfferAnswered` and `PlacementChanged`.
4. The backend reads both events from the receipt and updates its copy straight away, so the response is already consistent. The live listener delivers them again moments later, which is harmless because every write can be repeated.
5. The public dashboard's "placed" figure for that batch now includes this student — without the student ever being named.

---

## 6. Known gaps, stated plainly

- **Not deployed publicly yet.** Everything runs on a local Hardhat chain. Polygon Amoy is the planned target; an earlier attempt was paused for lack of test gas.
- **The Pinata key is in the browser bundle.** Job-description documents are pinned to IPFS from the frontend, so `VITE_PINATA_JWT` is shipped to every visitor. Pinning has to move to the backend, and the key has to be replaced, before any public deployment.
- **One college per deployment.** The data model allows several, but routes such as the talent pool assume one.
- **Resumes are unverified by design.** The platform vouches for the placement record, not for what students write about themselves.
- **The classmate lookup is a weak secret.** College emails are often guessable from roll numbers; the rate limit carries as much of the protection as the roll-number-plus-email pair does.

## 7. What has been verified

| Check | Result |
|---|---|
| Contract tests | 213 / 213 |
| Backend tests | 177 / 177 |
| Live suites | all 3 pass against a running stack |
| Frontend | builds, and lint passes |
| Public dashboard | checked visually in dark and light themes, at desktop and phone widths |
| Recovery path | tested repeatedly: chain restart → redeploy → backend restart → reseed, with every role still able to log in |
