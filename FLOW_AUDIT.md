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

*`D:\Blockchain` — this file is meant to be re-read and updated as gaps get closed, not archived.*
