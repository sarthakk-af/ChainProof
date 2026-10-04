# ChainProof — Technical Report

How ChainProof works under the hood, written so every part can be explained confidently in a viva. For the plain-language version, see [TEACHER_OVERVIEW.md](TEACHER_OVERVIEW.md).

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
  - The verifier may suspend anyone. A College may suspend only a Company it admitted itself (`admittedBy`).
  - A suspension is lifted only by whoever imposed it, or by the verifier (`suspendedBy`). Before this, any Active College could reinstate a company the administrator had suspended.
- **Batch sizes** (`recordBatchStrength`) are stored per college, course and year. Each change emits `BatchStrengthRecorded` with **both the old and the new value**, so shrinking the denominator is always visible.

### `PlacementDrive.sol` — what a company came to offer

- `postDrive` (company only): role, annual package, minimum CGPA (stored ×100 so comparisons are exact), batch year, deadline, drive date, and the content hash (a CIDv1) of the full job description. The drive starts `Proposed`. The backend writes the description, stores it, and computes that hash itself (`driveDocument.js`), so the text shown to students can always be checked against the chain.
- The college calls `approveDrive` or `rejectDrive`. Either side may `cancelDrive`. The company may `closeDrive`.
- **No function edits a drive's terms.** A test fails if the contract ever gains a function named like an editor (`edit…`, `update…`, `set…`, `amend…`, `revise…`). The cutoff is published before applications open, so it can't be tightened afterwards to justify a rejection.
- `recordApplicationCount` lets the company publish how many applied. Individual applications stay off-chain (personal data, hundreds per drive); only the total is public. The company signs it because the college's conversion rate depends on it.
- Nothing is deleted. A cancelled drive stays visible.

### `DriveOutcomes.sol` — what happened, and who is placed

- `recordStage` (only the company that owns the drive) appends one of Shortlisted / Assessment / Interview / Offered / NotSelected, plus the company's own label (e.g. "Tech Round 2"). History is append-only, and the same stage can't be recorded twice in a row.
- `recordStage` accepts only students registered under the drive's own college. Otherwise a student of one college, accepting an offer on another college's drive, would raise the wrong college's placed count.
- `answerOffer` (only the student, only while the student is Active, and only while an offer stands on an open drive): Accepted or Declined, answered once per offer.

**How the placed count stays correct.** This is the mechanism to be able to explain.

- **Accepting** increments `standingAcceptedOffers[student]`. The first time a student has one, they're marked placed, and `placedCount[college][batchYear]` goes up.
- **Withdrawing an accepted offer** (the company records a later stage) decrements that counter. The student is un-placed only when it reaches zero. So someone holding two accepted offers stays placed if one is withdrawn.
- **An offer made again is a new question.** Recording `Offered` again clears the student's earlier answer, so they can answer the new offer. This also stops a double count. Before the fix, an answer stayed attached to an offer that had already been withdrawn. Withdrawing a re-made offer then released the old acceptance a second time, which un-placed a student whose offer from another drive still stood.
- **A cancelled drive can only be wound down.** Its offers can't be accepted any more. The company can still record `NotSelected`, so an offer it already made can be withdrawn. Otherwise an accepted offer would count as a placement forever, for a drive that never ran.
- **Un-placing uses the cohort the student was originally counted in** (`placedUnderCollege`, `placedUnderBatchYear`). The count always falls in the same place it rose.
- **Every change emits `PlacementChanged`** with the new total, so the backend mirrors the contract's own answer rather than recomputing it.

### `PreparationLog.sol` — what the college did to prepare students

- `recordEvent` (Active College only): kind (Training / Mock interview / Workshop / Seminar / Other), title, who ran it, date held, attendance, batch (0 means all batches), and an optional document hash. It also stores `recordedAt`, the block timestamp. That timestamp is what separates a log kept as the year went from one put together at the end.
- **There is no edit function.** `cancelEvent` marks a session as not having happened. The original stays visible, `standingEventCount` goes down, and the reason is emitted.
- The date can be at most a year ahead: a college may record a scheduled session, but a date years away is a typo.
- This is the one contract where the college writes about itself. Everywhere else it is held to account for *results*; this holds it to account for *effort*.

### Compiler

Solidity 0.8.20 with the optimiser on at 200 runs — the usual middle ground for contracts deployed once but called often.

### Contract tests — 229

| File | Tests | Covers |
|---|---|---|
| `ActorRegistry.test.js` | 77 | roles, split admission, resubmission, suspension and who may lift it, batch sizes, byte limits |
| `PlacementDrive.test.js` | 54 | who may post, approve, cancel; terms can't be edited; applicant count |
| `DriveOutcomes.test.js` | 53 | company-only stages, student-only answers, placement up and down, two-offer case, re-offers, cancelled drives, own-college students only |
| `PreparationLog.test.js` | 28 | college-only authorship, bounds, no edits, cancellation, counting |
| `v2-integration.test.js` | 17 | a full season across all contracts |

---

## 3. The backend (`backend/`)

### Custodial wallets (`wallets.js`, `crypto.js`, `treasury.js`)

- At signup the backend generates a wallet, encrypts its private key (AES-256-GCM), and stores it. The key is decrypted only for the moment a transaction is signed.
- A **treasury** wallet sends each new wallet a little gas. When the treasury runs low, signup says so clearly rather than failing vaguely.
- **A wallet that runs out of gas is topped up before its next transaction.** Wallets used to be funded once, at signup, so a wallet that ran dry — or every wallet at once, after a local chain restart wipes all balances — could never transact again, and its owner saw only a generic failure. The check runs inside the wallet's own queue slot, so it costs one balance read per transaction and cannot race the send.
- **A wallet is funded only when it is first used, not at sign-up.** Funding at sign-up meant every abandoned sign-up, or one made with a mistyped email, cost the treasury a full grant. Now the same check funds an empty wallet just before its first transaction. That first transaction is always the account's on-chain registration, which needs a confirmed email for students and companies alike, so an account whose email was never confirmed costs nothing. Sign-up still checks that the treasury could fund one more account, and refuses with a clear message when it can't.

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

- **A roll number alone is not proof.** It was: the route asked for a college and a roll number, and roll numbers run in sequence. Whoever typed a classmate's number first was verified as that student, had their real name, course and batch copied onto their own account, was written to the chain as a student of that college — and the real student was told their roll number was already taken, with no way for the placement cell to undo it. The roster now carries the college email each row belongs to, and a row auto-verifies only the account that signed up with that address. Anything else — a row with no email, a mismatch, a student whose address changed — goes to the placement cell's queue, where a person decides.
- **A wrong claim can be taken back.** `POST /college/roster/:rollNumber/release` frees the row and clears that account's verification. It cannot erase an on-chain registration, because nothing can; when the account was already written to the chain the response says so and points at the owner's suspend button.
- **Claiming and approving are each one database transaction.** Both wrote three rows in sequence without one. A crash in the middle left the roster row claimed by an account the platform did not consider verified — which read, to the student, as their own roll number being taken by someone else, permanently.

### Resumes, directory and talent pool

- **Profile fields are declared once** in `studentProfile.js`. The database columns, validation, the profile form and the roster upload are all generated from that list, so adding a field is one edit.
- **Resume entries** (`resume.js`): projects, experience, education, certifications, achievements. They're self-claimed and unverified by design. Links must be `http`/`https`, which blocks `javascript:` links.
- **Skills** are stored normalised ("React.js" and "react js" match) but displayed as typed.
- **Talent pool** (`routes/talent.js`, company only): filter by course, batch, CGPA, skills (all must match) and placed status.
  - The database query never selects name, email or phone, so a serializer can't leak them by mistake.
  - Contact details — and profile links such as LinkedIn, which name their owner — unlock for one student and one company when that student applies to that company's drive. A student can withdraw an application until the company records a stage for them, which locks them again.
  - Only verified, Active students holding a roster row are listed. Students still in the queue, rejected, suspended, or whose roll number was taken back are not.
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
- **Catch-up works on a public network.** It reads in chunks of `INDEXER_BLOCK_RANGE` blocks (2,000 by default), because public RPC providers refuse one query over a wide range. After a new deployment it starts at the block the contracts were deployed in (`deployBlock`, recorded by `scripts/deploy.js`), not at block 0.
- **A failed event holds the position back.** The saved position never moves past it, so it's retried instead of lost.
- **Every write can be repeated safely.** Each event arrives twice in normal use — once when a route processes its own receipt, once from the listener. The batch table only counts a *newer* event with a *different* size as a revision; this fixed a bug where the public page showed batches as "revised" when they never were.
- **Redeploying resets the copy.** A fresh chain is detected by its deploy timestamp. The copied chain data is cleared, and so are the rows that only made sense on the old chain (student verifications, roster claims, notices). Logins are kept.
- **The copy can be rebuilt.** If its tables were deleted, restarting would rebuild them from the chain.

- **The sync cursor cannot pass a block that isn't mirrored.** It is a single "everything up to here" watermark, and two things used to move it past a gap. A *failed* handler only logged, so the next success — necessarily from a later block — carried the watermark over the gap, which backfill then resumed above: one transient RPC error lost an approval permanently. And the fourteen listeners run independently with very different handler durations, so a later block finishing first moved the watermark while an earlier block was still being processed. The cursor now waits for the lowest block that is either in flight or known to have failed, and failures are rows in `sync_failures` rather than a Set the process forgets when it restarts.

### Other safeguards

- **Idempotency keys** on posting a drive, recording a stage and recording a preparation session: a retried request can't create a duplicate. A key reused with a *different* request is refused, rather than silently returning the earlier result. Two things about the first version defeated its own purpose and are fixed:
  - It **freed the key whenever the work threw**. `tx.wait()` throws on a dropped connection or a replaced transaction — after the node has accepted the transaction. Freeing the key let the retry send a second one. A send that may have landed now leaves the key unresolved, and the retry is told to check before trying again, which is the only answer that cannot create a second permanent record.
  - It **lived in memory**, so a restart forgot every key — and a crash between the chain write and the response is exactly the case it exists for. The records are rows now.
  - The preparation route had no key at all, so a retry wrote the session twice — into the one record the college is not allowed to edit.
- **A mirror failure is never reported as a chain failure** (`syncAfterWrite`). Routes used to update the local copy inside the same `try` as the transaction, and two of those updates read back from the chain — so one RPC hiccup after a confirmed write told the user their update had *failed*, for a record that was on-chain forever. The block is now marked unsynced (holding the cursor below it, for reconciliation to repair) and the request still succeeds.
- **Error messages say what happened without saying what shouldn't be said** (`chainErrors.js`). A contract's revert reason passes through, because it names the rule that was broken. A dry treasury used to report its own address and balance to any signed-in user, and a wallet that failed to decrypt reported OpenSSL's internals; both are now generic.
- **Suspension is checked wherever an account acts**, not only where it owns something: applying to a drive, answering an offer, reading a drive's applicants, editing a notice, and editing the profile and resume that recruiters read. Each of those checked role or ownership and not status.
- **A half-created college can be finished.** Creating it registers on-chain and then approves; if the approval failed, the mirror had no college (so the "one college only" check passed) while the chain had one (so the email check refused), and no route could approve on its own — the platform was unbootstrappable without editing the database. The call now picks up where it stopped.
- **Signup takes the account row before spending gas on its wallet.** The other way round, two signups racing on one email both drew a drip from the treasury and the loser's insert failed, leaving a funded wallet with no account pointing at it.
- **Rate limits** by user: registration, results, drives, preparation records, and login/signup.
- **Clean errors:** malformed JSON gets a 400, not a crash or a 500.
- **Startup takes the port first.** If port 4000 is taken, the backend exits with a clear message *before* touching the database. Previously, a second copy reset the shared database and then kept running in the background.
- **Production guard:** the backend refuses to run against a non-local chain with the known Hardhat development keys.
- **Job descriptions are written by the backend** (`driveDocument.js`). It stores the description and writes its content hash (a standard CIDv1) on-chain with the drive's terms. Anyone can hash the text they were shown and compare it with the chain. Uploading from the browser used to ship the Pinata key to every visitor. Without the key, the description was discarded and a random hash-shaped string went on-chain instead.
- **The website probe only reaches the public internet** (`websiteCheck.js`). Checking a company's website used to fetch any URL from inside the server, including `localhost` and cloud metadata addresses. Every connection now checks the address it is about to reach, inside its own DNS lookup, so DNS rebinding can't get past the check. Redirects are re-checked at every hop.
- **Accounts can be deleted** (`POST /auth/delete-account`, `db/erasure.js`). This erases the login, profile, resume, skills and applications. On-chain records stay, tied to an address nothing links back to the person. The college's roster row stays, because it is the college's record.
- **Admin sessions can be ended.** Signing out, or changing `ADMIN_PASSWORD`, invalidates every admin token.
- **Nothing is recorded until the network has made it final** (`chain.js`'s `settle`). On a public chain the newest blocks are provisional for a few seconds; now and then the network settles on a different block and a transaction moves or disappears. Each write therefore waits until Polygon reports its block as *finalized* (2–5 seconds on Amoy) before the platform mirrors it or reports success, and the indexer reads only finalized blocks. Locally there is nothing to wait for, so this is off there (`WAIT_FOR_FINALITY`).
- **Responses carry baseline security headers.** `/health` no longer publishes the treasury's address or balance.
- **The email-code endpoints give one answer either way**, so they no longer reveal which addresses have accounts.
- **The chain is checked, not assumed (`chainHealth.js`).** Restarting a local Hardhat node wipes it: no contracts, no history, no balances. The backend used to keep serving against the empty chain, so every action failed with ethers' `could not coalesce error`, which named nothing useful. Now it verifies at start-up that the manifest's contracts have code, and re-checks every 15 seconds while running. A wiped chain makes it refuse to start, or stop serving with one sentence naming the fix: deploy again, then restart. `/health` reports the same message, and the check's answers carry CORS headers so the browser shows them instead of discarding them as "failed to fetch".

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

### Backend tests — 273

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

## 6. The live deployment

ChainProof runs at **https://chainproof.duckdns.org**: an AWS EC2 server with nginx, HTTPS from Let's Encrypt, and the backend kept running by PM2 (see [DEPLOY.md](DEPLOY.md)). Its contracts are on **Polygon Amoy**, deployed on 3 October 2026 at block 49,232,429. Anyone can inspect them on Polygonscan:

| Contract | Address |
|---|---|
| `ActorRegistry` | [`0x6e3CDabC5CB3E1BE57D18a8F7D6B6e89BeC3f7a7`](https://amoy.polygonscan.com/address/0x6e3CDabC5CB3E1BE57D18a8F7D6B6e89BeC3f7a7) |
| `PlacementDrive` | [`0x8274938F947c4966dBafA7673C86E3386bF967FD`](https://amoy.polygonscan.com/address/0x8274938F947c4966dBafA7673C86E3386bF967FD) |
| `DriveOutcomes` | [`0x19071D8D4c7e3E06F8EAE88Cc3018E91e0e01444`](https://amoy.polygonscan.com/address/0x19071D8D4c7e3E06F8EAE88Cc3018E91e0e01444) |
| `PreparationLog` | [`0x1675Cf70b09b58469E5e96Cc303Bcd90fBe48F78`](https://amoy.polygonscan.com/address/0x1675Cf70b09b58469E5e96Cc303Bcd90fBe48F78) |

Deploying cost 0.29 POL. Each account is then given 0.04 POL for its own transactions when it first acts on-chain, from the deploy wallet, which is also the platform verifier.

## 7. Known gaps, stated plainly

The platform is built for **one college**: its placement cell signs in and runs the season, and every route assumes that single college. The contracts would allow several, but supporting more than one is not a goal.

- **Whoever runs the backend could sign as anyone.** This is the price of custodial wallets, and the most important limit of the design. The contracts check `msg.sender`, so they guarantee that each record was signed by the right *wallet* — a company's offer by the company's wallet, a student's acceptance by the student's. But the backend holds every wallet's private key (encrypted, with the key to decrypt them in its own configuration), so the person operating the server could in principle sign with any of them. What the design does guarantee: no *user* of the website can write another party's facts, and nothing written can be changed afterwards by anyone, the operator included. What it does not: protection from a dishonest operator writing new records in someone's name. The fix is to let users hold their own keys (a browser wallet, or keys derived on the user's device), at the cost of the "no crypto knowledge needed" experience.
- **Resume links are visible while browsing.** Profile links are hidden until a student applies, but a project link (often a GitHub repository) can still carry a username.
- **Resumes are unverified by design.** The platform vouches for the placement record, not for what students write about themselves.
- **A student's CGPA is self-declared, by design.** It decides which drives they may apply to, so the on-chain cutoff is checked against a figure the student typed. That is a deliberate choice: the student is responsible for what they declare, and a wrong figure is the student's own misrepresentation to the company, which surfaces at the interview.
- **The classmate lookup is a weak secret.** College emails are often guessable from roll numbers; the rate limit carries as much of the protection as the roll-number-plus-email pair does.

## 8. What has been verified

| Check | Result |
|---|---|
| Contract tests | 229 / 229 |
| Backend tests | 273 / 273 |
| Live suites | all 3 pass against a running stack, with finality waiting both off and on |
| Frontend | builds, and lint passes |
| Public dashboard | checked visually in dark and light themes, at desktop and phone widths |
| Recovery path | tested repeatedly: chain restart → redeploy → backend restart → reseed, with every role still able to log in |
