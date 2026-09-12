# ChainProof — Flow & Gap Audit

Two diagrams, drawn as plain text so they're readable anywhere: how an account
earns the right to write to the chain, and how one action turns into a public,
permanent record. Followed by exactly what's collected today, and every point
where "verified" currently just means "typed something."

Audited directly against the code, not the documentation, as of this file's
last edit.

---

## 1. The trust chain — sign up → authorized to act

```
                        +---------------------------+
                        |         Sign up            |
                        |   email + password only    |
                        +--------------+--------------+
                                       |
                                       v
                        +---------------------------+
                        |  Custodial wallet created   |
                        |   + funded automatically    |
                        |  (no identity attached yet) |
                        +--------------+--------------+
                                       |
                                       v
                        +---------------------------+
                        |       Choose a role         |
                        |  Student . College . Company|
                        +--------------+--------------+
                                       |
                    +------------------+------------------+
                    | if Student                if College / Company |
                    v                                      v
        +-----------------------+           +-----------------------------+
        | Enter a name, pick a    |           | Enter a name +               |
        | college, and enter      |           | optional website             |
        | that college's invite   |           |                               |
        | code                    |           |                               |
        +-----------+-------------+           +---------------+---------------+
                    |  checked: does the code            |  [!] checked: under
                    |  match this college's own          |      100/200 chars, and
                    |  code? (fixed -- see #3)           |      the URL actually
                    |                                     |      responds (fixed -- #2)
                    v                                      v
        +-----------------------+           +-----------------------------+
        | On-chain status:        |           | On-chain status: Pending     |
        | ACTIVE -- immediately   |           +---------------+---------------+
        | [ok] bound to a real    |                           |
        |      college contact    |                           v
        +-----------+-------------+           +-----------------------------+
                    |                           | Admin reads the name, checks |
                    |                           | the CIN/accreditation ID,    |
                    |                           | clicks the website link      |
                    |                           | [ok] real evidence to weigh, |
                    |                           | [!] but still a manual check |
                    |                           +---------------+---------------+
                    |                                           |
                    |                                           v
                    |                           +-----------------------------+
                    |                           | Approve -> Active             |
                    |                           | Reject -> Rejected (may retry)|
                    |                           +---------------+---------------+
                    |                                           |
                    +--------------------+----------------------+
                                          v
                        +---------------------------+
                        |     Dashboard unlocked      |
                        |  role-specific actions open |
                        +---------------------------+
```

`[!]` marks what's still just a person glancing at a text field; `[ok]` marks
what now has real evidence behind it. The Student branch used to accept any
dropdown pick as institutional fact — it now requires a code only the real
college can hand out. The College/Company branch still routes through an
admin whose evidence is a name and a website — now at least confirmed to
actually be a live site, but still nothing that proves who runs it.

---

## 2. The record pipeline — one click to a public number

```
+----------------+     validates     +----------------+   writes tx   +------------------+
| Dashboard action| ----------------> |    Backend      | ------------> |  Smart contract   |
| Issue credential |                  | caller is Active|               | permanent record, |
| / Announce visit |                  | + recipient real|               | emits an event     |
+----------------+                   +----------------+               +--------+----------+
                                                                                 | emits
                                                                                 v
                                                                        +------------------+
                                                                        |     Indexer       |
                                                                        | catches the event  |
                                                                        |    on-chain        |
                                                                        +--------+----------+
                                                                                 |
                                             indexes into the mirror            |
              +----------------------------------------------------------------+
              v
+-------------------+   serves   +----------------+   +----------------------+
|   SQLite mirror     | ---------> |  Public API    |-->|   Public dashboard    |
| fast local cache --  |          |  /public/*      |   | anyone, no login,     |
| never the source of  |          |  routes         |   | drills into the record|
| truth                 |          +----------------+   +----------------------+
+---------+-----------+
          | reads (own records only)
          v
+-----------------------+
|  Student's dashboard    |
|  same mirror, read-only |
|  nothing to write here  |
+-----------------------+
```

The mirror is deliberately disposable — it exists only so the app isn't
reading the chain on every click. If it's ever wiped or gets out of sync, the
contract is still the only thing anyone actually has to trust (and the
backend now detects a fresh chain deployment and rebuilds the mirror from
scratch automatically — see the indexer's redeploy check).

---

## 3. What's actually collected today

The complete field list per account type — nothing below is abbreviated.

### Student — registers instantly
| Field | Check today | |
|---|---|---|
| email | non-empty + `@`/domain shape (fixed — see gap ledger #1) | now enforced |
| password | >= 8 characters, >= 1 digit | enforced |
| name | non-empty, <= 100 **bytes** (UTF-8, so a Devanagari name counts ~3x) — any text at all; duplicates allowed but flagged to the admin | self-reported |
| college | picked from a dropdown, plus a join code only that college can hand out | bound by invite code |

### College — queued for admin review
| Field | Check today | |
|---|---|---|
| email / password | same rules as Student | — |
| name | non-empty, <= 100 **bytes** (UTF-8, so a Devanagari name counts ~3x) — any text at all; duplicates allowed but flagged to the admin | self-reported |
| website | optional; must be a real URL shape, and a live probe checks it actually responds | shape + reachability checked |
| accreditation / ID | required; sanity-checked for length/characters, shown publicly | present, format-checked |

### Company — queued for admin review
| Field | Check today | |
|---|---|---|
| email / password | same rules as Student | — |
| name | non-empty, <= 100 **bytes** (UTF-8, so a Devanagari name counts ~3x) — any text at all; duplicates allowed but flagged to the admin | self-reported |
| website | optional; must be a real URL shape, and a live probe checks it actually responds | shape + reachability checked |
| CIN / registration no. | required; validated against the real CIN format (21 chars, e.g. L12345MH2020PLC123456) **and unique across all accounts** | present, format-checked, unique |

---

## 4. The gap ledger

Ordered by how early each sits in the chain — an unfixed gap near the top
undermines everything built on it after.

1. **Email format is never validated at signup** — ✅ *fixed*: a real
   `@`/domain shape check now runs server-side, and the account is unusable
   (can't log in) until a one-time code emailed to that address is entered
   back — see `/auth/signup`, `/auth/verify-email`, `/auth/resend-otp` in
   `backend/src/routes/auth.js`. Brute-forcing the 6-digit code is capped at
   5 wrong attempts before a fresh code is required, and requests are rate
   limited on top of that.

2. **Website is collected but never actually checked** — ✅ *fixed
   (partially, by design)*: the URL now has to actually be a URL (http/https,
   a real hostname), and a live HTTP probe at registration time records
   whether the address actually responded — shown in the admin queue as
   "Site responded" / "Could not reach this site". Deliberately stops short
   of proving *ownership* of the domain (e.g. a verification token placed on
   the site) — that depends on external DNS/HTTP infrastructure outside this
   project's control, and failing unpredictably mid-demo is worse than being
   honest this only confirms "reachable," not "owned."

3. **No student is ever confirmed to attend the college they pick** — ✅
   *fixed*: every Active college now gets an 8-character invite code
   (generated the moment it's approved, viewable/regeneratable from its own
   dashboard) that it hands to its real students. Registering as a Student
   now requires that code to match the chosen college, or it's rejected
   before ever touching the chain. Deliberately not an institutional-email
   domain match — that would make the app itself undemoable, since nobody
   testing or demoing this has a real `@college.edu` address to sign up
   with; a college-issued code is the same trust mechanism (Google Classroom
   codes, Discord invites) without that dependency.

4. **Admin approval has no evidence to weigh** — ✅ *fixed*: College and
   Company registration now requires a registration/accreditation number.
   For companies this is validated against India's real CIN structure (21
   characters, e.g. `L12345MH2020PLC123456`) — an actually-wrong CIN can't
   even be submitted. For colleges (no single universal ID format across
   AICTE/UGC/state boards/universities) it's sanity-checked for length and
   character set. Shown to the admin with a one-line hint on where to look it
   up (MCA registry for a CIN), and shown publicly too — same reasoning as
   the website: a number meant to be independently checkable is more useful
   visible than hidden. Doesn't *automate* the registry lookup itself —
   India's MCA/AICTE/UGC databases don't offer a free public API to check
   against, so this stops at "format is definitely valid," and the actual
   lookup is still a manual step for the admin, same as the website check.

5. **"Admin" is one shared secret, not a person** — ✅ *fixed*: real named
   admin accounts (username + password) now exist. The old shared secret
   still exists but can only bootstrap a new admin account
   (`POST /admin/admins`) — it can no longer list, approve, or reject
   anything itself. Every actual verification decision requires a per-admin
   login session (`POST /admin/auth/login`, a 12-hour token — shorter than a
   normal user session since approve/reject is the most consequential action
   in the app) and is logged with exactly which admin made the call. Verified
   live: the shared key alone now gets a 401 on `/admin/actors`; a real login
   session works and shows up in the decision log as "by sarthak".

6. **The contract itself will accept anything** — ✅ *fixed*: all three
   contracts now enforce their own input bounds, so the guarantee holds even
   with the backend bypassed entirely. `ActorRegistry.register` rejects an
   empty or over-long name (`InvalidNameLength`) and over-long metadata
   (`MetadataTooLong`); `CredentialIssuer` rejects a bad IPFS hash on both
   `issueCredential` and `issueCorrection`; `PlacementTracker.announceVisit`
   rejects an empty/over-long company name, a bad hash, and a zero date. The
   limits are public constants (`MAX_NAME_LENGTH` etc.) so anyone can read
   what the rules are without the source.

   One subtlety worth knowing: Solidity measures `bytes(s).length`, not
   characters. A 40-character Devanagari name is 120 bytes — over the 100
   limit. The backend therefore measures UTF-8 byte length too (see
   `backend/src/limits.js`), so such a name gets a readable "name must be 100
   bytes or fewer" instead of passing the backend and then reverting
   on-chain. Verified both ways: directly against the deployed contract with
   a raw wallet (all bounds revert with the right error and the right
   reported length), and through the backend (120-byte name rejected cleanly,
   90-byte name registers and round-trips intact).

7. **Two colleges can register under the identical name** — ✅ *fixed*, but
   not by blocking duplicate names. The name turned out to be the wrong thing
   to make unique: real institutions genuinely share one (there are several
   "Government Polytechnic"s), so blocking it would reject honest
   registrations while still doing nothing about the actual problem — the
   same organisation registering twice. Uniqueness is enforced on the
   **registration number** instead, which is the identifier that really can't
   be shared:

   - A Company must give a valid **CIN** (`L12345MH2020PLC123456` — the
     21-character MCA format, checked against a regex, not just non-empty).
     A College gives its accreditation / registration ID.
   - A new `registration_number_claims` table holds the identifier with a
     `PRIMARY KEY`, so the database itself is what refuses a duplicate — two
     simultaneous requests can't both win.
   - The claim is taken **before** the on-chain write and released if that
     write fails. This matters because the actor row only exists *after* the
     chain confirms it — a plain `UNIQUE` column on the actor table couldn't
     have stopped a duplicate until something permanent had already happened.
     Releasing on failure means a crashed attempt doesn't lock the real owner
     out of their own CIN forever.
   - A resubmission by the *same* address is always allowed, including under
     a changed number — its old claim is dropped first.
   - Duplicate **names** are still allowed, but no longer invisible: the
     admin queue shows an amber "Name shared with another registration" badge
     so a human weighs it, and the public dashboard now labels each college
     by its registration number rather than its wallet address, so a visitor
     can tell two same-named colleges apart.

   Verified live against the running stack: first company claims a CIN and
   goes Pending; a second account sending the *same* CIN under a totally
   different name gets `409 — "That CIN is already registered to another
   account"`; that same second account then registers fine under the *same
   name* as the first with a different CIN. Claim table confirmed to hold the
   two CINs against two distinct addresses. Backend suite 70/70 (four new
   tests cover missing CIN, malformed CIN, a CIN claimed by another address,
   and same-address idempotency), contracts 96/96, frontend builds clean.

---

## 5. The flow audit

The ledger above was organised by *entity*. Re-walking the system by **journey**
found things an entity-by-entity read cannot, because the worst gaps live in the
handoffs between roles rather than inside any one of them.

All eight are complete. Each was attacked directly over HTTP, bypassing the
UI's own validation, and every finding below was reproduced live before being
fixed and re-proved after.

| # | Flow | What came out of it |
|---|---|---|
| 1 | Becoming a user | 2 fixed — one inbox became two accounts; a reset left you locked out |
| 2 | Claiming an identity | Held. 3 hardened — gas burned on a race, ID spellings, an unreleasable claim |
| 3 | Getting verified | Held. 2 hardened — gas burned on a race, an accidental token separation |
| 4 | A college's placement cell | **2 real bugs** — a college could declare its own students placed |
| 5 | A company hiring | **2 real bugs** — a false success, and the race a third time |
| 6 | A student's credentials | **1 critical** — a rescinded offer could be presented as valid |
| 7 | The public surface | **1 privacy leak** — the student roster was served to anonymous callers |
| 0 | The foundation | 2 fixed — no throttle on gas spending; IPFS hashes never validated |

Read in that order the shape is clear: **the flows that had been demoed most
held up, and the ones nobody had reason to click through were where the real
problems lived.** The three worst findings — the forged proof, the self-issued
placement, the public roster — were all in paths that work perfectly when used
as intended and were never exercised any other way.

One pattern recurred often enough to be worth stating as a rule rather than
three separate fixes:

> **Any check-then-write against shared state must repeat its check inside the
> lock that serialises the write.** The pre-lock check exists for fast, friendly
> rejection; only the in-lock one is authoritative.

It appeared in registration, in approval, and in correction. In every case the
end state was already correct — the contracts refused the duplicate — but the
loser reached the chain and paid gas to revert, and was shown a message about
an on-chain failure rather than "someone got there first".

Sections below are in the order the work was done, worst-known-first, not in
journey order.

### Secrets and deployment credentials (one real bug)

Prompted by the code being pushed to GitHub — the first time any of this left
the machine.

**Nothing leaked.** No `.env` or `.key` file is tracked, in the working tree or
in any commit in the repository's history. The Brevo API key appears zero times
across all history. `JWT_SECRET` and `WALLET_ENCRYPTION_KEY` in the real `.env`
are distinct from the values hard-coded in the test files — worth checking,
since sharing them would have published the key that encrypts every custodial
wallet. The `0xac0974…` key that does appear in test files is Hardhat's
published account #0: public by design, and useless anywhere else.

**But nothing stopped a real network being started with development keys.**
`VERIFIER_PRIVATE_KEY` and `TREASURY_PRIVATE_KEY` are Hardhat defaults, which is
correct locally and catastrophic anywhere else. The verifier decides which
colleges and companies are legitimate; the treasury funds every user's wallet.
Both keys are derived from a mnemonic printed in Hardhat's own documentation,
so anyone in the world holds them. Pointing `RPC_URL` at Amoy with the current
`.env` would have started cleanly, looked entirely normal, and handed control of
the platform to strangers — and the deployment step is precisely what is still
pending.

`config.js` now refuses to start against a non-local RPC when it finds a
well-known development key, a weak or placeholder `JWT_SECRET`, or a malformed
`WALLET_ENCRYPTION_KEY`, and prints the commands to generate replacements. It
derives all 20 default Hardhat accounts rather than checking only the first, so
account #5 is no safer than account #0.

Verified both directions, because a false positive here would be equally
damaging — it would teach you to switch the check off: the real `.env` against
Amoy is refused with a specific reason per problem, freshly generated
credentials against Amoy are accepted, and local development with Hardhat keys
is untouched. Seven tests in `test/config-guard.test.js`, run in child
processes since the check happens at import time.

Two things checked and found already correct: the frontend contains no
`dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function`, so React
escapes every rendered value and the stored `<script>` payloads from the
hostile-input pass display as text; and CORS is pinned to a single origin
rather than `*`, so a page on another domain cannot read an authenticated
response.

### Hostile input — a deliberate attack pass (one real bug)

The flow sections above all ask "who is allowed to do what?". This one asks a
blunter question: what happens when the input is garbage, forged, malformed,
the wrong type, or aimed at a URL that shouldn't answer. 145 checks, in
`backend/test/attacks/hostile-input.mjs`.

The rule for reading it: **a 4xx is a pass** — the server understood and
refused. A 500, a hang or a crash is a failure, even on absurd input, because
an unhandled exception is where real vulnerabilities start. The server's health
is re-checked after every section.

**Malformed JSON returned HTTP 500.** `{"broken`, `not json`, a bare `42`, a
lone quote, `NaN` — all answered "Internal server error", and a 2MB body did
too. Three things wrong with that: a *client's* mistake was reported as a
*server* fault, so monitoring can't tell a genuine outage from someone posting
junk; every such request wrote a full stack trace to the log, meaning anyone
could flood it at will just by sending `{`; and a body that exceeded the size
limit never got the 413 that would tell a caller why. The error handler now
recognises body-parser failures (`entity.parse.failed` → 400,
`entity.too.large` → 413, `encoding.unsupported` → 415), logs them at warn with
no stack, and keeps the 500-with-stack path for faults that really are ours.

Everything else held:

- **Forged tokens.** `alg=none`, a token signed with an invented secret, a real
  token with one signature character flipped, a payload edited to point at
  another user, an expired token, and eight kinds of junk — all 401. Odd
  `Authorization` header shapes too.
- **URLs that shouldn't answer.** Every guarded route refused without a session.
  Nine path-traversal and encoding variants (`/public/../admin/actors`,
  `..%2f`, `%2e%2e`, a null byte, doubled slashes, upper-case `/ADMIN/`) reached
  nothing. `.env`, `package.json`, `src/config.js`, the SQLite file and
  `node_modules` are not served.
- **Injection.** SQL, XSS, template (`{{7*7}}`), Log4Shell-style
  (`${jndi:...}`), path traversal, null bytes and shell metacharacters, in
  registration fields, the login form and URL parameters — all rejected by
  validation, with the users table intact afterwards. Queries are parameterised
  throughout, so the SQL payloads were only ever going to be stored as text.
- **Type confusion.** Numbers, `null`, booleans, arrays, objects and nested
  arrays where strings belong — 400 every time, no crash. Numeric extremes for
  a timestamp (`NaN`, `Infinity`, `1e308`, `MAX_SAFE_INTEGER + 1`, negatives,
  fractions) all refused.
- **Prototype pollution.** `__proto__`, `constructor.prototype`, and a raw
  `__proto__` body — `Object.prototype` untouched.
- **Unicode and control characters.** Null bytes, CRLF header-injection
  attempts, right-to-left override, zero-width joiners, 200 combining marks,
  emoji, and Devanagari over the byte limit — all handled, none 500.
- **No internal leakage.** No stack trace, file path, SQLite error or bcrypt
  hash appears in any error response.

Two notes on the method, because they affected whether the results meant
anything. Early runs showed dozens of `status 0` results that looked like
dropped connections; they were the harness's fault — `fetch` refuses a body on
a GET, so those requests never left the client. And many checks initially
"passed" with a **429**: the rate limiter answered before the validation under
test ever ran, which is a refusal but not evidence. Both were fixed — a fresh
account per payload so the per-user limiter can't mask a result, and signup's
type handling moved to `test/auth-flow.test.js` where nothing is in the way,
rather than left as a check that proved nothing.

### Flow 6 — the forged proof (fixed)

**This was the most serious bug in the project.** The student dashboard's
timeline correctly displayed `superseded` and `isCorrection`, but
`ProofGenerator` read neither. Combined with its per-credential visibility
toggles, a student could disclose a rescinded job offer, untick the correction
that rescinded it, and generate a document headed "cryptographically
verifiable proof" of a job they did not have.

Every guarantee upstream — immutable records, append-only corrections, an
admin-verified issuer — was defeated at the last step, by the share button.

The fix draws the line where it belongs. **Choosing what to disclose is
legitimate**; nobody should have to hand over their whole history to show one
offer letter. **Misrepresenting what you do disclose is not.** So a credential
may be omitted entirely, but never shown without its current status: any
correction superseding a disclosed credential is pulled in automatically and
can't be toggled off. It walks the whole chain, not one link — a correction can
itself be corrected, and stopping at the first hop would show a superseded
record without showing what replaced it. (That second bug was caught by the
test written for the first one, before it shipped.)

Two supporting problems surfaced in the same pass:

- The proof said "verify on-chain at the ActorRegistry/CredentialIssuer
  contract addresses" — **without naming them.** A recruiter was told to verify
  and given no way to. It now carries the network, chain id, all three contract
  addresses, a gateway URL per credential, and six numbered steps ending in the
  only sentence that matters: *the chain is authoritative, this document is
  not.*
- Credentials identified their issuer only as a hex address. They now carry the
  issuer's registered name and role, joined in `getCredentialsForStudent`.

Locked in by `frontend/test/proofGenerator.test.js` — the project's first
frontend tests, 7 of them, written as the specification for the guarantee.

### Flow 7 — the public surface (one privacy leak)

24 checks. The carefully-designed part held perfectly; the leak was next door
to it, in routes nobody had thought of as public.

**The entire student roster was served to anonymous callers.** `/students` and
`/students/:address/credentials` were mounted with no authentication at all.
With no login, anyone could pull every student's real name, wallet address,
which institution they attend, whether they have a job, and their complete
credential history.

What makes this worse than an ordinary oversight is the contrast: three metres
away, `/public/colleges/:address/records` painstakingly strips student identity
from the records behind a college's percentage — the privacy boundary the whole
public dashboard is built around. And then a route that was never *meant* to be
public handed out the roster with names attached. The care was real; it just
wasn't applied where it wasn't being looked at. For a placement platform
holding Indian students' employment outcomes, "Bob is not placed" being world-
readable is precisely the disclosure the design was trying to avoid.

Both routes now sit behind a session, scoped by who is asking:
a Company sees candidates, which is what the platform is for; a College sees
**its own** students and nobody else's — and passing `?college=` for someone
else's roster is ignored rather than obeyed; a Student sees only themselves; a
fellow student gets a 403. Covered by nine tests in `test/students.test.js`,
which previously asserted the unauthenticated behaviour as though it were
correct.

What held up: no join code appears in any published payload (checked in both
the public list and the college directory — the invite code is the only thing
binding a student to a real institution, so leaking it would undo Flow 4's
guarantee); a published record names the issuing company but carries no
student name, no student address, and no `studentAddress` field at all; and the
published figures match `totalPlacedStudents` and `totalRegisteredStudents`
read straight off the chain. Malformed addresses, unknown colleges, and a
student address passed where a college is expected all return 404 rather than
leaking anything.

### Flow 5 — a company hiring (two real bugs)

Companies hold the only credential type that moves the public number, so this
flow carries more weight than it did before Flow 4. 18 checks; two defects.

**An idempotency key wasn't bound to the request it stood for.** The store
memoized on `(userId, key)` alone, so a key reused with *different* inputs
returned the earlier call's receipt and a `201`. Demonstrated live: a company
issued an Offer to student one with key K, then issued to student two with the
same K — got `HTTP 201`, and student two had **zero** credentials written.
The caller is told the offer was issued; it wasn't. A silent false success is
the worst failure available here, because nothing prompts anyone to check.

The frontend rotates its key when inputs change, so the UI didn't trigger it —
but "our own client happens to avoid it" isn't a guarantee, it's a coincidence.
Keys are now bound to a SHA-256 fingerprint of the payload: a genuine retry
still replays safely, while the same key with different details is refused with
a 409 that says to use a fresh key. Covered by `test/idempotency.test.js`.

**The check-then-write race, for the third time** — now in the correction path.
Two concurrent corrections of one credential: the loser reached the chain and
reverted, and because ethers couldn't decode the custom error, the message was
`"On-chain correction failed: execution reverted (unknown custom error)"`. Gas
spent, and nothing a user could act on. Re-checked under the lock; the loser
now gets `409 — "This credential has already been corrected once."`

That pattern has now appeared in registration, approval and correction. It is
worth stating as a rule rather than three incidents: **any check-then-write
against shared state must repeat its check inside the lock that serialises the
write.** The pre-lock check is for fast, friendly rejection; only the in-lock
one is authoritative.

What held up: a Pending company can't issue; one company cannot correct
another's credential, and neither can the student's own college — only the
original issuer; correcting a non-existent id returns 404; and the edge case
that matters most, a student holding offers from two companies **stays placed**
when one rescinds, because the other still stands.

### Flow 4 — a college running its placement cell (two real bugs)

25 checks across join codes, visit announcements and issuance. Two genuine
defects, one of them the most consequential finding in the whole audit.

**A college could declare its own students placed.** It issued itself an
`Offer` credential and its public placement rate went from 0/1 to 1/1 — 100%,
with no company involved anywhere. This is the exact thing ChainProof exists
to stop: placement statistics that the institution being measured reports about
itself. Every other guarantee in the system was intact and the headline number
was still forgeable in one API call.

Fixed by rule: **only a Company can create an Offer.** A college can still
issue General, Shortlist, Interview and Rejection credentials to its own
students — it just can't create the record that means "placed", because only
the employer can truthfully assert it made an offer. Enforced in
`CredentialIssuer.sol` (`OnlyCompanyCanIssueOffer`) so it holds even with the
backend bypassed entirely, again in the backend so the refusal reads as a
sentence rather than a decoded revert, and the option is filtered out of the
college's issue form so nobody is offered a choice that will be refused. The
correction path is guarded too — correcting a Shortlist *into* an Offer would
otherwise have been the same hole with an extra step.

**A college could issue to any student, anywhere.** There was no check that the
recipient was actually enrolled at the issuing college, so any approved college
could write records onto students at another institution — vouching for people
it has no relationship with, and moving another college's public figures, which
are grouped by the student's own college. A college's issuance is now bounded
to its own students. Companies are deliberately unbounded: they recruit across
institutions, which is the whole point of them.

What held up: a Pending or Rejected college can't issue, announce, or touch a
join code; only a college can read or regenerate its own code; a regenerated
code immediately invalidates the old one; one college's code can't enrol a
student into another; two concurrent regenerations leave storage and the read
API agreeing on the same single code; zero, non-integer and missing visit
dates are refused, as are empty and over-long company names.

One thing left deliberately alone: a visit can be announced with a date in the
past. It's almost always a typo, but backfilling a visit that already happened
is legitimate, and it isn't a safety question — blocking it would cost more
than it saves.

### Flow 3 — getting verified (hardened)

Attacked the admin path over HTTP: 31 checks on authentication, replay,
concurrency, attribution and hostile input. Nothing produced a wrong end
state; two things were tightened.

- **Two admins clicking Approve at the same instant burned gas.** Same shape as
  the registration race in Flow 2 — both requests passed the "is it still
  Pending?" check before either wrote, so both reached the chain and the
  loser's transaction reverted. The audit log stayed correct (one entry), but
  the second admin paid gas and was shown "On-chain transaction failed", which
  reads like a system fault rather than "someone beat you to it". The check now
  repeats inside `withWalletLock`, and the loser gets
  `409 — "Another admin already decided this one (current status: Active)."`
- **A user session and an admin session were only separated by accident.**
  `verifyAdminToken` explicitly demands `type: "admin"`, so a user token can't
  reach the queue. The reverse had no such check: an admin token's `sub` is an
  admins-table id, and since both tables use small autoincrement integers, it
  usually also names a real and unrelated user. What actually rejected it was
  the tokenVersion comparison — an admin token carries none, and `undefined`
  never equals a number. Correct today, but it means a later change to that
  check silently converts an admin session into somebody else's user session.
  `userAuth` now refuses on type.

What the attacks confirmed already worked: the queue is unreachable with no
token, a valid *user* token, a malformed token, or the shared bootstrap secret
(which can create admins but not make decisions); a wrong admin password
doesn't reveal whether the username exists; approving or rejecting an
already-decided actor returns 409 and leaves the status untouched; an unknown
address returns 404; a rejection reason of 5000 characters is truncated to 500;
`<script>` tags and `DROP TABLE` in a reason are stored verbatim and never
executed; and — the important one — **the audit log cannot be made to lie**:
supplying `adminUsername`, `admin` or `username` in the request body changes
nothing, because attribution comes from the authenticated session and is
anchored by a transaction hash. A rejected applicant can also still resubmit
with a corrected identifier, with the stale rejection reason cleared.

### Flow 2 — claiming an identity (hardened)

Attacked directly over HTTP, bypassing the UI's client-side validation
entirely — 23 checks covering concurrency, normalisation, role confusion and
hostile input. The path held: no attack produced a wrong end state. Three
things were tightened anyway.

- **A concurrent double registration paid gas to fail.** Two requests fired
  together from one account both passed the "already registered?" check before
  either wrote, so both reached the chain and the loser's transaction reverted
  with `AlreadyRegistered`. The end state was always correct, but a revert
  still costs gas, and the caller controls how often it happens. The check is
  now repeated *inside* `withWalletLock`, where only one request runs at a
  time, so the loser is refused with a 409 having touched nothing. Verified:
  the pair now returns `201, 409` where it used to return `201, 400`.
- **One registration ID had several spellings.** Uniqueness is enforced on the
  identifier, but `EDU/MH/2024/0142` and `EDU / MH / 2024 / 0142` were
  different strings — so a single institution could hold two claimable
  identities, making the guarantee decorative. Now canonicalised
  (`normalizeRegistrationNumber`): uppercased, whitespace collapsed, and spaces
  removed either side of `/`, `-` and `.`. CIN validation is unaffected.
- **A claim could become permanently unreleasable.** `claimRegistrationNumber`
  compared addresses case-insensitively while `releaseClaimsForAddress` matched
  exactly. Ethereum addresses are checksummed mixed-case, so a differently-cased
  caller would count as the owner but free nothing — locking that CIN forever,
  with no recovery short of direct database access. Both are now
  case-insensitive. Latent rather than live (every current path passes the same
  `req.user.address`), but the failure mode was unrecoverable, which is reason
  enough.

What the attacks confirmed already worked: two accounts racing for one CIN
(exactly one wins, one claim row, one actor); a lowercased and padded CIN still
refused; a Student unable to squat a CIN, enrol into a Company, or enrol into
themselves; an Active actor unable to change role; `javascript:`, `data:`,
`ftp:` and malformed URLs all refused; oversized and multi-byte names rejected
on byte length — and in every rejected case, no CIN claim left behind.

### Flow 1 — becoming a user (fixed)

Most of this flow held up better than expected. Single-use reset links, the
OTP attempt counter, the generic "if that email is registered" response, and
session eviction on password change were all already covered by tests — an
earlier note here claiming single-use was untested was simply wrong.

Two real defects did surface:

- **An email differing only by case created a second account.** `Sarthak@Gmail.com`
  and `sarthak@gmail.com` are one inbox everywhere in the real world, but
  lookups were case-sensitive, so they became two accounts — two custodial
  wallets, two gas drips from the treasury, one human. Worse, someone who
  signed up with one capitalisation and typed another at login got "invalid
  credentials" with nothing to explain it, and `/forgot-password` would
  silently do nothing for them, because it deliberately never reveals whether
  an address is registered. A perfect dead end. Fixed by normalising in the
  database layer (`normalizeEmail` in `db/users.js`) so every path — signup,
  login, OTP, resend, reset, check-email — inherits it and they can't drift
  apart later.
  - The migration for existing rows deliberately **refuses** to lowercase a
    row where that would collide with another account, logging it for a human
    instead. Each account owns a funded wallet; silently deleting one to
    tidy up the data would be worse than the problem. This path ran for real
    during testing and behaved exactly that way.
- **Completing a password reset didn't verify the email.** Someone who forgot
  their password before ever entering the OTP would reset it successfully,
  then still be refused at login and sent hunting for a code that had long
  expired. Opening a link delivered to an inbox is at least as strong a proof
  of control as typing back a code from the same inbox, so a completed reset
  now marks the address verified.

One thing deliberately *not* changed: `/auth/check-email` reveals whether an
address is registered. That's a conscious trade — the signup form needs to say
"that email's taken" as you type, and `/signup`'s own 409 reveals the same
thing. `/forgot-password` stays generic because that's the endpoint an
attacker actually probes.

### Flow 0 — operational gaps (fixed)

Found by reading the code rather than using the app, since neither is visible
from the UI:

- **Nothing rate-limited the endpoints that spend gas.** Login, signup and OTP
  were carefully throttled; `/me/register`, `/credentials/issue`,
  `/credentials/:id/correct` and `/visits/announce` were not — and those are
  the only calls that cost real money, paid from the treasury. The custodial
  wallet design means the user never feels that cost, so nothing discourages
  hammering them. Invisible on Hardhat, where accounts hold thousands of test
  ETH; on a real network one logged-in user in a loop drains the treasury.
  Fixed in `backend/src/middleware/chainWriteLimiter.js`, keyed **by
  authenticated user, not IP** — an entire college behind one NAT would
  otherwise throttle its own students.
- **The IPFS hash was never validated as a hash.** The check was "non-empty and
  under 200 bytes", so any string could be written on-chain permanently. A
  record pointing at a hash that resolves nowhere is worse than no record: it
  looks verifiable and isn't. Now checked as a real CIDv0 or CIDv1
  (`backend/src/ipfsHash.js`). The app's own end-to-end script had been
  exploiting this without meaning to.
  - This exposed a trap: the no-Pinata fallback generated `QmMock` + hex, and
    hex contains `0`, which base58 excludes — so strict validation would have
    worked with Pinata configured and broken without it. The mock now emits a
    properly-shaped CIDv0, verified unique across 2000 generations.

---

*`D:\Blockchain` — this file is meant to be re-read and updated as gaps get closed, not archived.*
