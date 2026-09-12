# ChainProof — Manual Test Plan

A step-by-step script for testing every entity by hand. Work top to bottom:
the admin has to exist before a college can be approved, a college has to be
approved before it can invite students, and so on. Each step says what to do,
what you should see, and — where it isn't obvious — *why that check matters*,
so you can answer an examiner who asks "so what?"

Legend: **Do** = the action, **Expect** = what proves it worked,
**Why** = what would be broken if it didn't.

---

## Part 0 — Setup

### 0.1 Start the three services

Three separate terminals, in this order. Each must stay running.

| # | Directory | Command | What it is |
|---|---|---|---|
| 1 | `D:\Blockchain` | `npx hardhat node` | The local blockchain (port 8545) |
| 2 | `D:\Blockchain\backend` | `npm run dev` | API + indexer (port 4000) |
| 3 | `D:\Blockchain\frontend` | `npm run dev` | The web app (port 5173) |

Between 1 and 2, deploy the contracts once:

```
cd D:\Blockchain
npm run deploy:local
```

**Expect:** the deploy prints three contract addresses. The backend terminal,
on start, detects the fresh deployment and rebuilds its local mirror from
scratch.

**Why:** the SQLite database is only a *cache* of what's on-chain. A new chain
means the old cache is meaningless, and the backend is supposed to notice that
by itself rather than serve stale numbers. If you ever see leftover data from a
previous run, that detection is broken — a real finding worth reporting.

### 0.2 Confirm everything is up

Open these in a browser:

- <http://localhost:5173> → the landing page loads
- <http://localhost:4000/admin/health> → `{"status":"ok","blockNumber":N}`

If `blockNumber` is missing, the backend can't reach the chain — fix that
before going further, or every on-chain step below will fail confusingly.

### 0.3 Start from a clean slate (optional but recommended)

To wipe all accounts and start fresh:

1. Stop the backend (Ctrl+C).
2. Delete `backend\data\chainproof.sqlite` (and the `-wal` / `-shm` files
   beside it if present).
3. Restart the backend.

The chain itself still holds the old records, but since the mirror is rebuilt
from chain events, restarting Hardhat too (step 0.1 from the top) gives you a
genuinely blank system.

### 0.4 Create the admin account

There is no default admin — one has to be created using the bootstrap secret
from `backend\.env` (`ADMIN_API_KEY`). In PowerShell:

```powershell
curl.exe -X POST http://127.0.0.1:4000/admin/admins `
  -H "Content-Type: application/json" `
  -H "x-admin-key: YOUR_ADMIN_API_KEY" `
  -d '{\"username\":\"sarthak\",\"password\":\"AdminPass123\"}'
```

**Expect:** `201` with the new admin's username.

**Why:** this is deliberately the *only* thing the shared secret can still do.
Everything else in the admin panel needs a real named login, so that the
decision log can record *which person* approved an institution rather than
just "an admin". Try running it twice — the second attempt must return `409`,
because usernames are unique.

---

## Part 1 — Admin

The admin panel lives at a separate URL and does not share a session with the
normal app: <http://localhost:5173/admin>

### 1.1 Login

| | |
|---|---|
| **Do** | Open `/admin`. Enter a wrong password first. |
| **Expect** | "Invalid username or password" — and note it does *not* say whether the username exists. |
| **Why** | Telling an attacker "that username is right, wrong password" hands them half the credential. |

| | |
|---|---|
| **Do** | Log in with the correct password. |
| **Expect** | The queue loads; your username appears in the header with a Sign Out button. |

**Also test:** hit <http://localhost:5173/admin> in a fresh private window and
try to reach the queue without logging in — you should be held at the login
screen. And confirm that reloading the page keeps you logged in (the session
is stored), while Sign Out drops you back to the login form.

### 1.2 Read the review queue

| | |
|---|---|
| **Do** | With at least one pending college/company (Part 2/3 below), look at a queued row. |
| **Expect** | Name, role, wallet address, **registration number / CIN**, website link, and a website-reachability badge. |
| **Why** | This is the evidence an admin weighs. Before this existed, approving was guesswork — a name and nothing else. |

Check the filter toolbar: filter by role and by status, and confirm the counts
change sensibly. On a narrow window the toolbar should wrap onto two lines
rather than pushing a horizontal scrollbar onto the page.

### 1.3 The duplicate-name warning

| | |
|---|---|
| **Do** | Register two companies with the *same name* but different CINs (Part 3). Look at both rows. |
| **Expect** | Both show an amber "Name shared with another registration" badge. |
| **Why** | Real institutions genuinely share names, so this isn't blocked — but the admin should *see* it and check the registration numbers before approving. Judgement, not a hard rule. |

### 1.4 Approve

| | |
|---|---|
| **Do** | Approve a pending college. |
| **Expect** | Status flips to Active, and a transaction hash is shown. The row leaves the Pending filter. |
| **Why** | The tx hash is the proof this was a real on-chain action, not a database edit. You can paste it into the Hardhat terminal output to find the matching block. |

### 1.5 Reject, with a reason

| | |
|---|---|
| **Do** | Reject a pending registration and type a reason. |
| **Expect** | Status → Rejected. The user sees your exact reason on their pending screen. |
| **Why** | A rejection with no explanation is a dead end for an honest applicant. |

**Then test the recovery path:** log back in as that rejected user and submit
the registration again — it must be allowed, and the old rejection reason must
be cleared. A single mistake should not permanently lock someone out.

### 1.6 The decision log

| | |
|---|---|
| **Do** | Scroll to Recent Decisions. |
| **Expect** | Every approve/reject, each tagged "· by sarthak", with its reason and timestamp. |
| **Why** | Accountability runs both ways — the institutions are audited, and so are the admins. |

### 1.7 Try to bypass the admin auth

| | |
|---|---|
| **Do** | In PowerShell: `curl.exe http://127.0.0.1:4000/admin/actors` (no token). |
| **Expect** | `401`. |
| **Do** | Try an approve with a *user* token instead of an admin token. |
| **Expect** | Rejected — user tokens and admin tokens are different types and aren't interchangeable. |

| | |
|---|---|
| **Do** | Send the shared `x-admin-key` secret to `/admin/actors`. |
| **Expect** | `401`. |
| **Why** | That secret can create admin accounts and nothing else. Verification decisions must be attributable to a named person, which a shared key can never be. |

### 1.8 Try to make the audit log lie

| | |
|---|---|
| **Do** | Reject an actor via the API, adding `"adminUsername": "someone-else"` to the request body. |
| **Expect** | The decision is recorded against *your* username, not the supplied one. |
| **Why** | If attribution came from the request, any admin could pin their decisions on a colleague — and the log would be worse than useless, because it would look authoritative while being forgeable. |

| | |
|---|---|
| **Do** | Reject one with a 5000-character reason, and another with `<script>alert(1)</script>'; DROP TABLE actors;--`. |
| **Expect** | First is truncated to 500 characters; second is stored and displayed as plain text, and the queue still loads. |

### 1.9 Two admins deciding at once

| | |
|---|---|
| **Do** | Open the admin panel in two windows, both showing the same pending row, and click Approve in both as close together as you can. |
| **Expect** | One succeeds. The other says "Another admin already decided this one" — **not** "On-chain transaction failed". |
| **Why** | Both messages leave the data correct, but the second one reads like a system fault and, on a real network, means the losing click actually paid gas for a transaction that reverted. |

---

## Part 2 — College

### 2.1 Sign up

| | |
|---|---|
| **Do** | Go to <http://localhost:5173>, choose Sign Up, enter `notanemail` as the email. |
| **Expect** | Refused — the email shape is checked server-side, not just by the browser. |

| | |
|---|---|
| **Do** | Try the password `abc`. |
| **Expect** | Refused: at least 8 characters with a digit. Watch the strength meter respond as you type. |

| | |
|---|---|
| **Do** | Enter mismatched password / confirm password. |
| **Expect** | Refused before submitting. |

| | |
|---|---|
| **Do** | Sign up properly with a **real email inbox you can open**. |
| **Expect** | You are taken to the OTP screen, **not** logged in. A 6-digit code arrives by email. |
| **Why** | If signup logged you straight in, email verification would be decoration. The account is deliberately unusable until the code is entered. |

| | |
|---|---|
| **Do** | Sign out, then try to sign up again with the **same address in different capitals** — e.g. `You+College@Gmail.com` for an account made as `you+college@gmail.com`. |
| **Expect** | Refused: "An account with this email already exists." |
| **Why** | Mail domains ignore case, so that's one inbox and must be one account. Treating them separately meant two custodial wallets funded from the treasury for one person — and someone who signed up with one capitalisation and typed another at login was told "invalid credentials" with no way to work out why. |

| | |
|---|---|
| **Do** | Log in using a wild mix of capitals in the email. |
| **Expect** | Works normally. |

### 2.2 Verify the email

| | |
|---|---|
| **Do** | Enter a wrong code. |
| **Expect** | Refused. Do it repeatedly — after several attempts that OTP is burned and you must request a new one. |
| **Why** | A 6-digit code is only 1,000,000 possibilities; without an attempt limit it's brute-forceable in minutes. |

| | |
|---|---|
| **Do** | Click Resend. |
| **Expect** | A 30-second cooldown before you can resend again; a new code arrives and the old one no longer works. |

| | |
|---|---|
| **Do** | Enter the correct code. |
| **Expect** | Verified, and you're logged in. |

**Also test:** before verifying, open a new tab and try to log in with the
correct password — you should be blocked and sent back to the OTP screen, not
let in.

### 2.3 Register as a College

| | |
|---|---|
| **Do** | Pick the College role. Submit with the name field empty. |
| **Expect** | Refused. |

| | |
|---|---|
| **Do** | Enter a website of `justtext` (no scheme/domain). |
| **Expect** | Refused — it must be a real URL shape. |

| | |
|---|---|
| **Do** | Paste a very long name (say 200+ characters). |
| **Expect** | Refused with a byte limit message. |
| **Why** | This value is written to the blockchain permanently. The contract enforces the same cap independently, so the limit holds even if someone bypasses the website entirely. Note it counts **bytes, not letters** — a name in Devanagari uses about 3 bytes per character, so ~33 such characters already reach 100 bytes. |

| | |
|---|---|
| **Do** | Submit a valid registration: name, website `https://example.com`, registration ID e.g. `EDU/MH/2024/0142`. |
| **Expect** | Status becomes **Pending** and you land on a waiting screen. |

| | |
|---|---|
| **Do** | Try to register a *second* college from a different account using the **same registration ID**. |
| **Expect** | `409` — "That registration ID is already registered to another account." |
| **Why** | Names can legitimately repeat; a registration number can't. This is what stops one institution registering itself twice. |

| | |
|---|---|
| **Do** | Try again with the same ID **spaced differently** — `EDU / MH / 2024 / 0142` for an ID registered as `EDU/MH/2024/0142`. |
| **Expect** | Still `409`. |
| **Why** | Uniqueness is enforced on this value, so if spacing produced a different string, one institution could hold two claimable identities and the guarantee would be decorative. |

### 2.4 Wait for approval

| | |
|---|---|
| **Do** | While Pending, look for any dashboard action. |
| **Expect** | None available — only the waiting screen. |
| **Why** | An unverified institution must not be able to issue anything. |

Now approve it as the admin (Part 1.4), then reload.

### 2.5 The join code

| | |
|---|---|
| **Do** | On the college dashboard, find the Join Code panel. |
| **Expect** | An 8-character code is **already there** the moment you become Active. |
| **Why** | It's generated at approval, not on first visit — otherwise there'd be a window where an active college has no code and every student trying to join it would be rejected. |

| | |
|---|---|
| **Do** | Click Copy, then Regenerate (confirm the prompt). |
| **Expect** | A new code. Write down the **old** one — you'll use it in 4.3 to prove it stopped working. |

Note the code has no `O`/`0` or `I`/`1` in it — it's meant to be read aloud or
written on a whiteboard without ambiguity.

### 2.6 Announce a company visit

| | |
|---|---|
| **Do** | Fill in the visit form: company name, a date, a title/description. |
| **Expect** | Submits, and the visit appears in the college's own feed **and** on the public dashboard's activity list. |

| | |
|---|---|
| **Do** | Open the browser console (F12) while submitting. |
| **Expect** | A line like `[IPFS] Pinned via Pinata: Qm...` |
| **Why** | The details are uploaded to IPFS first; only the resulting CID goes on-chain. See the Pinata section at the end. |

**Also try:** an empty company name, and a date left blank — both should be
refused rather than writing a junk record to the chain forever.

**API-level check** (the UI always supplies a real hash, so this one needs
PowerShell). Send an announcement or credential with `"ipfsHash": "hello"` and
expect a rejection naming the CID format. A record pointing at a hash that
resolves nowhere is worse than no record: it looks verifiable and isn't.

### 2.7 Issue a credential

| | |
|---|---|
| **Do** | Open the Issue Credential form. |
| **Expect** | The type defaults to **General**, not Offer. |
| **Why** | An accidental "Offer" silently marks a student as placed and moves the public statistics. The default is the harmless one on purpose. |

| | |
|---|---|
| **Do** | Issue a General credential to your student's wallet address (from Part 4). |
| **Expect** | Success with a tx hash; it appears on the student's timeline. |

| | |
|---|---|
| **Do** | Try issuing to a made-up address like `0x1234...`. |
| **Expect** | Refused — the recipient must be a registered student. |

| | |
|---|---|
| **Do** | Open the Credential Type dropdown as a **college**. |
| **Expect** | There is no "Offer Letter" option, and a line explains that offers come from the company. |
| **Why** | An Offer is the record that marks a student placed, and placement percentages are exactly what colleges are measured on here. A college issuing its own Offers would be the self-reported statistic this project exists to replace. If an examiner asks "what stops a college inflating its numbers?" — this is the answer. |

| | |
|---|---|
| **Do** | Try it through the API anyway: issue with `"credType": "Offer"` using a college's token. |
| **Expect** | `403` — "Only a company can issue an Offer…". |
| **Why** | The dropdown is convenience; the rule lives in the contract (`OnlyCompanyCanIssueOffer`) and holds with the frontend and backend both bypassed. |

| | |
|---|---|
| **Do** | With two colleges set up, have College A issue a credential to a student enrolled at College B. |
| **Expect** | `403` — "A college can only issue credentials to its own students." |
| **Why** | Otherwise any approved college could write records onto people it has no relationship with, and move another institution's public figures. A **company** deliberately isn't restricted this way — it recruits across colleges. |

---

## Part 3 — Company

### 3.1 Sign up and verify

Same as 2.1–2.2, with a different email address.

### 3.2 Register as a Company

| | |
|---|---|
| **Do** | Choose Company. Submit with no CIN. |
| **Expect** | Refused — the CIN is required. |

| | |
|---|---|
| **Do** | Enter `12345` as the CIN. |
| **Expect** | Refused — it's checked against the real 21-character MCA format, not merely "is it filled in". |

| | |
|---|---|
| **Do** | Enter a valid one: `L12345MH2020PLC123456`. |
| **Expect** | Accepted; status Pending. |

**Understanding the format** (useful if you're asked): `L` = listed company,
`12345` = industry code, `MH` = state (Maharashtra), `2020` = year of
incorporation, `PLC` = public limited company, `123456` = registration number.

| | |
|---|---|
| **Do** | From another account, try the **same CIN** with a totally different company name. |
| **Expect** | `409` — "That CIN is already registered to another account." |

| | |
|---|---|
| **Do** | From that same second account, now use the **same company name** as the first but a *different* CIN. |
| **Expect** | Accepted — and both now carry the duplicate-name badge in the admin queue (1.3). |
| **Why** | This pair of tests is the whole design in miniature: identity is the number, not the name. |

### 3.3 Get approved, then view candidates

Approve as admin, reload, and open the company dashboard.

| | |
|---|---|
| **Do** | Look at the candidate table. |
| **Expect** | Registered students are listed with their college. |

### 3.4 Make an offer

| | |
|---|---|
| **Do** | Issue an **Offer** credential to a student. |
| **Expect** | Tx hash returned. Within a few seconds the public dashboard shows that student's college placement count go up. |
| **Why** | Nobody typed "placement rate = 40%" anywhere. It's computed from records that actually happened. |

### 3.5 Rescind it — the correction flow

This is the most important thing to demonstrate.

| | |
|---|---|
| **Do** | Correct that Offer into a Rejection. |
| **Expect** | The student is no longer counted as placed; the college's percentage drops accordingly. |

| | |
|---|---|
| **Do** | Now look at the student's timeline and the public record list. |
| **Expect** | **Both** entries are still visible — the original offer, marked superseded, *and* the correction. Nothing was deleted. |
| **Why** | This is the difference between a blockchain and an ordinary database. A college that could quietly delete an embarrassing record would make the public number meaningless. History is append-only; corrections are additions, never erasures. |

| | |
|---|---|
| **Do** | Try to correct the *same* original credential a second time. |
| **Expect** | Refused — a credential can only be superseded once (correct the correction instead). |

| | |
|---|---|
| **Do** | Log in as the *college* and try to correct a credential the *company* issued. |
| **Expect** | Refused — only the original issuer can correct their own record. |

| | |
|---|---|
| **Do** | Have a *second* company try to correct the first company's credential. |
| **Expect** | `403`. Neither a rival employer nor the student's own college can touch a record they didn't write. |

### 3.6 The two-offer case

| | |
|---|---|
| **Do** | Have two different companies each issue an Offer to the same student. Then have one rescind. |
| **Expect** | The student **stays placed**, and the college's percentage doesn't move. |
| **Why** | Placement is re-derived from whichever offers currently stand, not counted up and down. Someone turning down one of two offers is still placed, and a naive implementation would wrongly un-place them. |

**Edge case worth testing:** give a student offers from **two different
companies**, then have one rescind. The student must **stay placed**, because
the other offer still stands.

---

## Part 4 — Student

### 4.1 Sign up and verify

Same as 2.1–2.2, with a third email address.

### 4.2 Register without a code

| | |
|---|---|
| **Do** | Choose Student. Pick the college from the dropdown, leave the invite code blank. |
| **Expect** | Refused. |

### 4.3 Register with the wrong code

| | |
|---|---|
| **Do** | Enter a made-up code, then the **old** code you noted in 2.5. |
| **Expect** | Both refused. |
| **Why** | Picking a college from a public dropdown proves nothing — anyone could claim to attend IIT. The code is the only thing tying a student to actual contact with that institution. And regenerating must genuinely invalidate the old code, or it's not a revocation. |

### 4.4 Register with the correct code

| | |
|---|---|
| **Do** | Enter the current code. |
| **Expect** | Status **Active immediately** — no admin approval needed. |
| **Why** | The college already vouched for them by handing over the code, so a second manual review would be pointless friction. |

### 4.5 The credential timeline

| | |
|---|---|
| **Do** | View the dashboard after the college/company issues credentials. |
| **Expect** | All credentials listed with issuer, type, and date; superseded ones clearly marked. |

| | |
|---|---|
| **Do** | Look for any edit or delete button. |
| **Expect** | There is none. A student can read their record, never write it. |

### 4.6 Generate a shareable proof

| | |
|---|---|
| **Do** | Use the Proof Generator on a credential. |
| **Expect** | A shareable proof containing the IPFS hash and the issuer. |

| | |
|---|---|
| **Do** | Read the `verification` block at the bottom of the proof. |
| **Expect** | The network, chain id, all three contract addresses, and six numbered steps — ending with "the chain is authoritative; this document is not." |
| **Why** | Telling a recruiter to "verify on-chain" without naming the contract is useless advice. This is the difference between claiming verifiability and providing it. |

| | |
|---|---|
| **Do** | Copy any credential's `documentUrl` and open it in a browser. |
| **Expect** | The credential's JSON loads — from a public gateway, nothing to do with our server. |
| **Why** | This is what makes it *verifiable* rather than merely displayed. A recruiter confirms the document independently of us. |

### 4.7 The forgery test — the most important check in this document

| | |
|---|---|
| **Do** | Have a company issue an Offer, then rescind it (Part 3.5). As the student, untick the **correction** and leave the **offer** ticked. Generate the proof. |
| **Expect** | The correction appears in the proof **anyway**, marked `includedAutomatically`, and an amber banner says it was added for you. The offer itself is marked `SUPERSEDED`. |
| **Why** | This is the attack the whole project exists to prevent: presenting a rescinded job offer as a real one. Selective disclosure is legitimate — misrepresenting what you *do* disclose is not. You may omit a credential entirely; you may never show one without its current status. |

| | |
|---|---|
| **Do** | Now untick **both** the offer and its correction. |
| **Expect** | Neither appears, and `disclosure` reads "Partial". |
| **Why** | Hiding the whole episode is honest — the recruiter is simply never told about it, rather than told something false. The distinction matters. |

---

## Part 5 — The public dashboard (no login)

Open <http://localhost:5173/public> in a **private/incognito window** to prove
no session is involved.

| | |
|---|---|
| **Do** | Read the top figures. |
| **Expect** | Verified colleges, companies, registered students, overall placement %. |

| | |
|---|---|
| **Do** | Look at how each college is labelled under its name. |
| **Expect** | Its **registration number**, not a wallet address. |
| **Why** | If two colleges share a name, this is how a visitor tells them apart — and it's a number they can look up independently. |

| | |
|---|---|
| **Do** | Use the search box and all three sort options (rate, name, most registered). |
| **Expect** | The list reorders correctly; searching a nonsense string empties it gracefully. |

| | |
|---|---|
| **Do** | Click a college to drill into its records. |
| **Expect** | Every individual credential behind that percentage, with issuer and type. |

| | |
|---|---|
| **Do** | Look for any student's name, email, or address in that list. |
| **Expect** | **None.** The record is public; who it belongs to is not. |
| **Why** | Accountability for the institution without exposing individuals — the whole design rests on that line being held. |

### 5.1 The routes that must NOT be public

Still in the private window, with no login, try these in the address bar:

| | |
|---|---|
| **Do** | <http://localhost:4000/students> |
| **Expect** | `401`. |
| **Why** | This used to return every student's real name, wallet address, college and whether they had a job — to anyone at all. It is the roster; it is not public. |

| | |
|---|---|
| **Do** | `http://localhost:4000/students/<a student address>/credentials` |
| **Expect** | `401`. |

| | |
|---|---|
| **Do** | Log in as a **college** and open the student list. |
| **Expect** | Only your own students. |
| **Why** | A college has no business reading another institution's roster. Try appending `?college=<the other college's address>` to the API call — it is ignored, not obeyed. |

| | |
|---|---|
| **Do** | Log in as a **student** and request `/students`. |
| **Expect** | `403` — a student cannot enumerate their peers. |

| | |
|---|---|
| **Do** | Search the public dashboard's JSON responses for a college's join code. |
| **Expect** | Not present anywhere. |
| **Why** | The invite code is the only thing binding a student registration to a real institution. Publishing it would undo that entirely. |

| | |
|---|---|
| **Do** | Leave the page open while a credential is issued in another window. |
| **Expect** | The numbers update on their own within ~15 seconds. |

---

## Part 6 — Cross-cutting checks

### 6.1 Mobile layout

In Chrome DevTools (F12 → device toolbar), set the width to **375px** and walk
through: landing, sign up, OTP screen, registration form, each dashboard, the
public dashboard, the admin panel.

**Expect:** no horizontal scrollbar anywhere; buttons reachable; tables either
wrap or scroll inside their own box rather than pushing the page sideways.

### 6.2 Session handling

- Log in, close the tab, reopen → still logged in.
- Log out → protected pages are inaccessible.
- Change your password → **existing sessions on other devices stop working**
  (this is what the token version counter is for; a password change has to
  actually evict a stolen session or it isn't a security measure).

### 6.3 Password reset

Use Forgot Password with a real inbox; confirm the email arrives, the link
works **once** (try it a second time — it must be dead), and the old password
no longer does.

**Also test the unverified case:** sign up, skip the OTP entirely, then use
Forgot Password and complete the reset. You should be able to log in straight
away — the reset marks the address verified. Opening a link sent to that inbox
proves control at least as well as typing back a code from it, and without
this you would reset the password successfully and still be locked out,
chasing an OTP that had already expired. A reset also evicts other logged-in sessions, same as a
password change — which is the point, since the usual reason to reset is that
someone else may have had access.

### 6.4 Resilience

| | |
|---|---|
| **Do** | Stop the Hardhat node, then try to register. |
| **Expect** | A clear error message — not a blank screen or a spinner forever. |

| | |
|---|---|
| **Do** | Restart Hardhat, redeploy, restart the backend. |
| **Expect** | The backend notices the new deployment and rebuilds its cache instead of serving stale records. |

### 6.5 Automated suites

Run these before any demo — they take under a minute combined:

```
cd D:\Blockchain          && npx hardhat test   # 100 contract tests
cd D:\Blockchain\backend  && npm test           # 102 API tests
cd D:\Blockchain\frontend && npm test           # 7 proof-integrity tests
cd D:\Blockchain\frontend && npm run build      # must build clean
```

Then, with the stack running, the seven live attack suites — the ones that
actually try to break things rather than confirm they work:

```
cd D:\Blockchain\backend  && npm run test:attacks
```

That replays every attack from the flow audit — forging a proof, a college
declaring its own students placed, reading the student roster without logging
in, racing two approvals, reusing an idempotency key — plus a hostile-input
pass: forged `alg=none` tokens, SQL and XSS payloads, path traversal at the
admin routes, prototype pollution, malformed and oversized bodies. Roughly 280
checks in total, each printing PASS or FAIL. See
`backend/test/attacks/README.md`.

---

## What the Pinata screen is

That dashboard is **IPFS storage** — the "documents" half of the system.

When a college or company issues a credential, the details (title, description,
issuer, type, date) are bundled into a small JSON file and uploaded to
[Pinata](https://pinata.cloud), which pins it on IPFS. Pinata returns a **CID**
— the `Qm...` string in that table — and *only that CID* is written to the
blockchain.

**Why it's split that way:** storing data on-chain is expensive and permanent,
and every byte costs gas. A CID is short and fixed-length, so putting it
on-chain is cheap — but because a CID is derived from the file's own contents,
it's also *tamper-evident*. Change a single character of the document and it
produces a completely different CID, which no longer matches what the chain
recorded. So we get cheap storage and proof of integrity at the same time.

Reading that screen:

- **Name** `ChainProof-1789037762781` — the label our code attaches, a
  timestamp (see `frontend/src/utils/ipfsService.js`). Each row is one
  credential or visit announcement from earlier testing.
- **CID** `QmXvQ...8xcYD` — the content address. This exact string is the
  `ipfsHash` stored on-chain and shown in a student's shareable proof.
- **Size** 268–396 B — these are tiny JSON documents, not files.
- `ChainProof-verification-test` (84 B) was the one-off connectivity check when
  Pinata was first wired up.

To see a row for yourself: click the copy icon next to a CID and open
`https://gateway.pinata.cloud/ipfs/<CID>`. The JSON that loads is the same
document the on-chain record points at — served by a public gateway, with our
backend completely out of the picture.

**Two honest caveats worth knowing before an examiner asks:**

1. If `VITE_PINATA_JWT` isn't set in `frontend\.env`, the app silently falls
   back to a **mock hash stored in browser localStorage** (`QmMock...`). The
   app keeps working, but that hash resolves nowhere. If you see `QmMock` in
   the console instead of `[IPFS] Pinned via Pinata`, IPFS is not actually
   being used — check your key.
2. Pinning keeps a file available; it does not make it private. Anything put on
   IPFS is public to anyone holding the CID. That's why credential metadata
   holds titles and issuers but no personal identifiers.

---

## Appendix — test data to copy

| Field | Valid | Invalid (should be refused) |
|---|---|---|
| Email | `you+college@gmail.com` | `notanemail`, `a@b` |
| Password | `TestPass123` | `abc`, `password` (no digit) |
| Company CIN | `L12345MH2020PLC123456` | `12345`, `ABC123`, blank |
| College reg. ID | `EDU/MH/2024/0142` | blank, a 200-character string |
| Website | `https://example.com` | `justtext`, `ftp://x.com` |
| Join code | the current 8-character code | a regenerated-away old code |
| Student address | copied from the student's profile | `0x1234` |

**Tip:** use Gmail's `+` addressing — `you+college@gmail.com`,
`you+company@gmail.com`, `you+student@gmail.com` all deliver to the same inbox,
so you can run all three roles and receive every OTP without extra accounts.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "On-chain registration failed" | Hardhat node not running | Restart it, redeploy, restart backend |
| OTP email never arrives | `BREVO_API_KEY` missing/expired | Check `backend\.env`; look for `signup_otp_send_failed` in the backend terminal |
| Old data after a redeploy | Mirror not rebuilt | Restart the backend; it rebuilds on detecting a new deployment |
| Admin panel shows the login form forever | Session expired (12 h) | Log in again |
| `QmMock...` in the console | `VITE_PINATA_JWT` not set | Add it to `frontend\.env` and restart the dev server |
| Student can't register | Join code was regenerated | Get the current code from the college dashboard |

---

*`D:\Blockchain` — update this as features change; a test plan that's drifted
from the code is worse than none.*
