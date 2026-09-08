# ChainProof — Technical Report

This explains **how** ChainProof actually works under the hood — the idea you already know; this is the implementation. Written so you can explain any part of it confidently if asked.

---

## 1. The Three Layers

ChainProof is three separate pieces of software that talk to each other:

```
Browser (React)  →  Backend (Node/Express)  →  Blockchain (Solidity contracts)
     frontend/              backend/                    contracts/
```

- **The blockchain layer** (`contracts/`) is the source of truth. Three smart contracts hold the actual permanent records — who's registered, what credentials exist, what visits were announced. Nothing here can be edited or deleted once written, only added to.
- **The backend** (`backend/`) is a normal Node.js server that sits between the user and the blockchain. It does two jobs: (a) it holds a blockchain wallet *on behalf of* every user, so they never touch crypto directly, and (b) it keeps a fast local copy of blockchain data (in a small SQLite database) so the website doesn't have to query the slow blockchain every time it needs to show something.
- **The frontend** (`frontend/`) is the React website — sign in, dashboards, forms. It never talks to the blockchain directly. It only ever talks to the backend over normal HTTP requests, the same way any website talks to its server.

Why this shape? A real blockchain requires a wallet, a private key, and gas money for every action — completely unreasonable to ask a student or a college placement officer to deal with. The backend exists specifically to hide all of that, while still making every action genuinely end up on the blockchain.

---

## 2. The Smart Contracts (`contracts/`) — the actual subject matter

Three contracts, deployed once, that never change after deployment (only their *data* grows). This is the layer most worth being able to explain the *reasoning* behind, not just the *what*.

### `ActorRegistry.sol` — who is who
Every wallet address that registers gets one record: a `role` (Student / College / Company) and a `status` (Pending / Active / Rejected).

- Colleges and Companies start `Pending` and need a `verifier` (the platform admin, via the backend) to approve them before they can do anything else. This stops anyone from registering as "IIT Bombay" and immediately issuing fake credentials.
- Students go `Active` immediately — they just declare which college they belong to, and that college must already be `Active`.
- If rejected, an actor **can register again** (a deliberate design decision — a rejection could be an honest mistake). The contract keeps a `rejectionCount` that survives resubmission, so a past rejection is never hidden even if a later attempt succeeds.

**How access control actually happens on-chain.** There's no username/password at the contract level — the wallet address that submits a transaction (`msg.sender`) *is* the identity. Every privileged function looks up `actors[msg.sender]` in a single mapping and checks both fields at once: the right `role` *and* `status == Active`. One struct lookup is the entire authorization check — this is the standard on-chain access-control pattern (as opposed to a centralized server checking a session cookie).

**How admin approval is enforced.** A single address, the `verifier`, is stored as a contract-level variable set at deployment. `approveActor`/`rejectActor` both start with a check that reverts the entire transaction unless `msg.sender == verifier`. This is a deliberate, explicit point of centralized trust — real-world institutional verification can't be solved by pure decentralization (something has to vouch that "this wallet really is Infosys"), so rather than pretend otherwise, that trust is concentrated in one known, auditable role instead of scattered informally.

**How resubmission preserves history instead of hiding it.** When a rejected actor calls `register()` again, the contract overwrites their entire record with the new role/name — *except* it reads the existing `rejectionCount` first and writes that same number back into the new record before anything else changes. Everything about the actor looks fresh except that one counter, which only ever goes up. That's the whole mechanism: selectively carry one field forward while replacing the rest.

### `CredentialIssuer.sol` — the actual records
Once a College or Company is `Active`, it can call `issueCredential(studentAddress, ipfsHash, credType)`. This is the core action of the whole platform. `credType` is one of General / Shortlist / Interview / Offer / Rejection.

**How the placement percentage stays automatically correct — the actual mechanism.** `issueCredential` doesn't just store the credential; at the end, it always calls one shared internal function, `_recomputePlacement(student)`. That function scans *all* of that student's credentials that haven't been superseded, and checks whether any of them is an `Offer`. If yes, and the student wasn't already marked placed, it flips `isPlaced = true` and increments that student's *college's* `totalPlacedStudents` counter; if a later correction removes their only Offer, the same function runs again, finds no active Offer left, and decrements it back down. `getPlacementPercentage(college)` never reads a stored percentage — it just divides `totalPlacedStudents / totalRegisteredStudents` for that one college, live, every time it's asked. **This is the answer to "what logic produces this output":** recompute from the full set of facts every time, rather than incrementing a running total by hand — which is what correctly handles a student holding two offers from different companies (rescinding one doesn't wrongly un-place them, because the scan still finds the other).

**How append-only corrections avoid breaking that math.** `issueCorrection()` never edits the old credential — it sets the old one's `superseded` flag to `true` and adds a brand-new credential row linked back to it via `supersedesId`. Because `_recomputePlacement` only ever looks at non-superseded credentials, correcting away someone's only Offer automatically un-places them, and correcting a Rejection into an Offer automatically places them — the exact same recompute function handles both directions, no separate "undo" logic was needed. **This exists in the contract and is fully tested, but is deliberately not exposed anywhere in the backend or frontend yet** — scoped as future work, not part of what's demoed today.

### `PlacementTracker.sol` — visit announcements
Much simpler: lets an `Active` College publish "Company X is visiting on date Y." Purely a permanent, timestamped log — no side effects on placement stats.

### A compiler detail worth knowing
The Solidity optimizer is enabled at 200 runs (`hardhat.config.js`). This is a real blockchain-specific trade-off: fewer runs optimize for cheaper *deployment*, more runs optimize for cheaper *repeated execution*. 200 is a standard middle-ground choice appropriate here since these contracts are deployed once but `issueCredential`/`register` get called constantly.

### Testing
83 automated tests (`test/ChainProof.test.js`) covering every authorization rule (who can call what, from what status), every event, the placement-percentage math under multiple edge cases (multiple offers, corrections in both directions), the resubmission flow, and the correction flow. All passing.

---

## 3. The Backend (`backend/`)

This is the most mechanically involved layer, because it's doing real work to hide blockchain complexity. Broken into what each piece is responsible for:

### Custodial wallets (`wallets.js`, `crypto.js`)
When someone signs up, the backend generates a brand-new blockchain wallet (a public address + private key) for them — this happens entirely server-side, the user never sees it. The private key is encrypted (AES-256-GCM) and stored in the database; it's only decrypted for the few milliseconds needed to sign a transaction, then discarded. This is *why* users never need MetaMask or to understand what a wallet even is.

### Authentication (`auth.js`, `middleware/userAuth.js`)
Normal email + password. Passwords are hashed (bcrypt), never stored in plain text. On login, the backend issues a JWT (a signed token) that the frontend attaches to every request. The JWT includes a `token_version` number that's also stored in the database — logging out (or resetting your password) bumps that number, which instantly invalidates every previously-issued token for that account. Without this, "logging out" would be cosmetic — the old token would keep working until it naturally expired.

### The transaction queue (`txQueue.js`) — a subtle but important detail
Every custodial wallet is re-created fresh from its encrypted private key on every request (nothing is kept in memory between requests, for security). The problem: blockchains require transactions from the same address to use sequential numbers ("nonces"), and if you ask the network "what's the next nonce?" for every request independently, two requests close together can get told the same number — causing one to fail with "nonce already used." `txQueue.js` fixes this by tracking the next nonce for each address itself (in memory), and processing requests for the same address one at a time. This was a real bug encountered and fixed during development, not a hypothetical.

### The event indexer (`indexer.js`, `db/`)
The blockchain is the source of truth, but querying it directly for every page load would be slow, especially for aggregate things like "list every student at this college." So the backend runs a background process that listens for every event the contracts emit (`ActorRegistered`, `CredentialIssued`, etc.) and mirrors them into a local SQLite database as they happen — plus a one-time "backfill" on startup to catch up on anything emitted while the backend wasn't running. **The SQLite database is a cache, not the real data** — if it were deleted, restarting the backend would fully rebuild it by re-reading the blockchain's history.

### Admin verification (`routes/admin.js`)
A separate, simpler authentication scheme (a shared secret key, `x-admin-key`) rather than a per-user login — because the platform admin isn't really "a user" with a role in the same sense, and Phase 2 of this project deliberately kept it minimal. This is what the `/admin` page in the frontend talks to, to approve or reject pending Colleges/Companies.

### Routes overview
| Route | Auth | Purpose |
|---|---|---|
| `/auth/*` | none (public) | signup, login, logout, password reset |
| `/me`, `/me/register` | user JWT | your own profile; register a role on-chain |
| `/credentials/issue` | user JWT | issue a credential (College/Company only) |
| `/visits/announce` | user JWT | announce a visit (College only) |
| `/students`, `/colleges` | none | read-only lookups used to populate dropdowns/lists |
| `/public/*` | none | the public dashboard's data — pure aggregation, no login |
| `/admin/*` | admin key | approve/reject pending institutions |

### Safety nets
Rate limiting on signup/login/password-reset (stops abuse of the treasury wallet that funds new users' gas). A global error handler so one bad request returns a clean 500 instead of crashing the process. Structured JSON logging on every state-changing action, so a real production issue would leave a traceable record.

### Testing
59 automated tests, covering validation logic, auth guards, and pure-database-read paths. Chain-touching happy paths (the actual "does a transaction succeed" cases) are deliberately verified manually against a live local blockchain rather than mocked — mocking ethers.js reliably proved not worth the effort, and a live check is more honest anyway.

---

## 4. The Frontend (`frontend/`)

### Routing without a router library
There's no React Router. `App.jsx` just checks `window.location.pathname` directly for a small number of fixed paths (`/admin`, `/public`, `/about`, `/profile`, `/reset-password`) and otherwise renders based on session state (logged in? registered? approved?). This was a deliberate simplicity choice — the app doesn't have enough distinct pages to justify a routing library.

### Session state (`context/AuthContext.jsx`)
A single React Context holds `status` (authenticated/not), `user` (email + wallet address), and `actor` (the on-chain role/status record, or `null` if not registered yet). Every component that needs to know "who is logged in" reads from this context rather than managing its own copy.

### The main screens
- **`LandingPage.jsx`** — what anyone not logged in sees: an explanation of the project, then (only after clicking "Create an account") the actual sign-up form.
- **`Registration.jsx`** — the second step after signup: pick a role, give a name (and a college, if Student).
- **`PendingApproval.jsx`** — shown to a College/Company waiting on admin approval; also owns the "resubmit after rejection" flow.
- **`StudentDashboard.jsx` / `CollegeDashboard.jsx` / `CompanyDashboard.jsx`** — the three role-specific views. Each is a thin layout file; the actual data-fetching lives in `hooks/` (one hook per data need) and the visual sections live in per-role subfolders (`components/college/`, `components/company/`, `components/student/`).
- **`AdminPanel.jsx`**, **`PublicDashboard.jsx`**, **`ProfilePage.jsx`** — the three pages reachable outside the normal role-dashboard flow.

### The design system (`index.css`)
Every color, font, spacing value, and shadow is a CSS custom property (a "token") defined once at the top of the file — nothing is hardcoded inline. This is *why* the light/dark theme toggle works: switching themes just swaps which set of token values is active; every component that uses `var(--text-primary)` etc. updates automatically, with zero component code touched.

### Data flow example — issuing a credential, start to finish
This is the clearest way to see all three layers work together:

1. A College clicks a student in the registry, fills in "Offer," clicks Issue (`IssueCredentialForm.jsx`).
2. The frontend sends `POST /credentials/issue` with a JWT (`api.js`).
3. The backend (`routes/credentials.js`) checks the JWT is valid, checks the caller is an Active College/Company (reading from its own indexed cache, not the chain — faster), then decrypts that user's wallet just long enough to sign.
4. It calls `issueCredential(...)` on the real contract, using `txQueue.js` to get a safe nonce, and waits for the transaction to be mined.
5. The moment it's mined, the backend reads the `CredentialIssued` event straight out of the transaction receipt and immediately updates its own SQLite cache — it doesn't wait for the separate background listener, so the API response is already consistent.
6. The frontend gets back a success response (with the transaction hash) and refreshes its own view.
7. Separately, the always-running background listener would also have caught this event, in case anything else changed the chain state outside this exact flow.

---

## 5. Known, Deliberate Gaps

Worth being able to name these confidently if asked, since they're decisions, not oversights:

- **`issueCorrection` and `rejectionCount` are not exposed in the UI.** Built and tested at the contract level; wiring them into the backend/frontend was explicitly scoped as future work to keep each phase bounded.
- **Document storage is mocked.** Credential metadata (title, description) currently lives in the browser's local storage as a placeholder rather than real decentralized storage (IPFS) — a deliberate, acknowledged simplification, not a hidden gap.
- **Currently deployed only to a local practice blockchain**, not a public testnet — a real deployment attempt was made (Polygon Amoy) and paused due to a gas-price/funding constraint on the day, a genuine engineering trade-off rather than an oversight.

---

## 6. What's Actually Been Verified

Not just "written," but checked:
- **83/83** contract tests passing.
- **59/59** backend tests passing.
- A full, fresh, end-to-end run today: sign up as a College → get admin-approved → a Student registers under that College → sign up as a Company → get approved → issue an Offer credential to that Student through the real UI → confirm the Student's dashboard shows "Placed" and the credential → confirm the Profile page and Public Dashboard both reflect it correctly → confirm the light/dark theme preference persists. All of it passed on a completely clean environment (fresh blockchain, fresh database) run today.
