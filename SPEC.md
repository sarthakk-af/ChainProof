# ChainProof v3 — agreed design

An internal placement platform for **one college**. Students, the college and
recruiting companies each act only for themselves — no entity writes another's
data. Parents and the public can see how placements actually went.

This file is a working agreement, not documentation.

---

## The one sentence

**On-chain is the record of the placement season. Off-chain is people.**

Who came to campus, what they offered, what the college did to prepare
students, and who actually got placed — permanent, and nobody can rewrite it
later. Names, resumes, skills, emails — changeable, personal, and with no
business being permanent.

Remove that split and this is a database with extra steps.

## Who signs what

The rule underneath every design decision here: **whoever would be embarrassed
by the lie is the one who has to sign it.**

| Party | Signs, on-chain |
|---|---|
| **College** | Cohort size (the denominator) · each student it admits as genuine · each company it lets in · each drive it agrees to host · each preparation event it conducts |
| **Company** | The drive and its terms — package, cutoff, deadline · how many applied · every candidate's stage — shortlisted, interviewed, offered, not selected · any offer it withdraws |
| **Student** | Accepting or declining an offer |
| **Admin** | Account actions only — created, suspended, reinstated |

So the college cannot inflate its placements, because it cannot author an
offer. The company cannot claim it hired someone who never said yes. A student
cannot claim an offer nobody made. Announcements may say whatever they like —
the signed record is what anyone checks them against.

## The four accounts

```
  ADMIN  — the project owner. Set up from .env at install, not a role anyone
           applies for. Creates the college account, suspends and reinstates
           accounts, resets a lost login, watches chain and treasury health.
           Plays by the same rules as everyone: manages ACCOUNTS, never RECORDS.
           Cannot post a drive, cannot record an outcome, cannot edit a result.
    |
  COLLEGE — one shared placement-cell login, created by the admin. Uploads the
           roster, declares cohorts, admits companies, hosts drives, verifies
           students the roster could not match, and records what it did to
           prepare students for placement.
    |
  COMPANIES + STUDENTS — sign themselves up.
```

The role picker is therefore **Student or Company**. The college never
registers through the UI; an internal tool does not ask its owner to sign up
for it.

### Why admin is not a god

It was tempting to let the owner fix anything. But the strongest sentence this
project has is *"even the person who built it cannot mark a student as placed —
only the company can, and it is on-chain."* An admin who can edit records
deletes that sentence, and with it the answer to "why is this on a chain at
all?". So the admin is a caretaker of accounts, and every account action it
takes is itself recorded.

## A student's path

1. **Sign up** — email and password. Straight into the app. No OTP wall.
2. **Unverified** — can browse every drive, package, cutoff and public figure,
   and fill in their profile. Cannot apply. Appears in no statistic. A banner
   always says exactly what is missing.
3. **Verify by roll number** — if the roster is already uploaded it matches at
   once; if it is not, they queue for the placement cell. Neither ordering
   strands anyone. Email confirmation is the second condition; whichever lands
   second completes it.
4. **Verified** — *now* they are written on-chain, and only now do they count
   in the registered-student figure that every percentage is divided by.
5. **Build a resume** — the college supplies the facts it owns (name, roll
   number, course, batch, CGPA) and the student writes everything else:
   skills, projects, internships, achievements, hobbies, links.
6. **Apply** — to drives they are eligible for, cutoff enforced with the reason
   shown, then answer any offer that follows.

**Unverified means look, don't touch.** The moment an unverified account can
apply or appear in a figure, the roll-number check stops being worth having.

## The resume

Deliberately **off-chain and entirely self-claimed**, except the fields the
college supplies from the roster.

A resume changes constantly — paying gas to immortalise a hobbies list is
absurd. And a false claim is self-correcting: it surfaces at the interview, and
it becomes the student's problem, not the platform's. What the platform
guarantees is not that a resume is true; it is that the *placement record* is.

Shape (all optional except what the roster gives):

```
FROM THE COLLEGE (not editable by the student)
  full name · roll number · course/branch · batch year · CGPA

FROM THE STUDENT
  headline · about · skills · projects · internships & experience
  education (10th/12th/other) · certifications · achievements
  hobbies · links (GitHub, LinkedIn, portfolio) · phone
```

## Who can see a student

| Viewer | Sees |
|---|---|
| **The student** | Everything, and edits their own half |
| **Another student** | Full profile — but only by looking it up with **both** the roll number and the email. Rate-limited, so nobody can crawl a batch |
| **A company, browsing** | Roll number, course, batch, CGPA, skills, projects, experience — **no name, no email, no phone**. Enough to judge a candidate, not enough to contact one |
| **A company, after the student applies** | Full contact details for that student only. The student unlocks it by applying |
| **The public** | Nothing individual. Aggregate funnels and placement figures only |

Companies browse and filter the whole pool — by course, batch, CGPA band,
skills, and whether the student is already placed — so they can see what kind
of students the college actually has before deciding to visit.

**A company can never contact a student directly.** It posts a drive, the
college hosts it, students apply. Remove that and the college stops being the
medium and the record stops being complete.

## Announcements vs records

An announcement is *"our interview moved to Hall B, bring two copies"*. It
changes, it gets corrected, it is stale in a week, and it is placement-related
only — nothing else belongs in this feed.

**Announcements are off-chain and editable. Drives, events and placements are
on-chain and permanent.** The announcement is never the record; the thing it is
about already is.

## College preparation events

New in v3, and the college's own record of effort: mock interviews, aptitude
training, resume workshops, seminars. **On-chain and permanent**, holding:

```
title · kind (training / mock interview / workshop / seminar / other)
date held · conducted by · students who attended
```

This matters because until now the college was accountable only for *reporting*
results. This makes it accountable for *preparing* for them, in a record it
cannot quietly revise later.

## Lifecycle

```
SETUP (per batch)
  College records batch strength on-chain   CSE 2026 = 180
  College uploads roster                    180 roll numbers
  College records preparation events        aptitude training, mock interviews

STUDENT                              COMPANY
  claims a roll number -> verified     self-registers, owns its profile
  builds a resume                               |
      |                            college confirms it's a real recruiter
      |                                         |
      |                            browses the anonymised talent pool
      |                                         |
      |                            posts opening: role, package,
      |                            eligibility, declared stages
      v                                         |
  sees openings; ineligible <-------------------+
  ones blocked with reason
      |
      v
  applies (unlocks own contact details to that company)
      |
      +--------------------> COMPANY records each stage
                               Shortlisted / Assessment / Interview /
                               Offered / Not selected  (+ own label)
                                            |
                                            v
                               OFFER -> student accepts or declines
                               only ACCEPTED counts as placed
                                            |
                                            v
  PUBLIC / PARENTS
  "TCS, 12 Mar, SDE, 6.5 LPA — 140 applied, 45 shortlisted, 12 offered, 9 accepted"
  "CSE 2026: 78 of 180 placed (43%) · 12 preparation events held"
```

## Contracts

| Contract | Role |
|---|---|
| `ActorRegistry` | Roles, approval, suspension/reinstatement, batch strength per course/year with the previous value in every event |
| `PlacementDrive` | The opening, the college's approval, the applicant total |
| `DriveOutcomes` | Stage transitions written by the company, accept/decline by the student |
| `PreparationLog` | **New** — what the college did to prepare students |

On-chain a student is only a wallet address. Names, roll numbers, CGPA,
resumes and private coordination never leave the database.

## Carried over unchanged

Auth, OTP, sessions, password reset, rate limiting, payload-bound idempotency,
the gap-aware indexer with reconciliation, treasury exhaustion handling,
custodial wallets, and every hostile-input hardening. None of it is
domain-specific; all of it stays.

## Design constraint on profile fields

The field list will keep changing. It is declared in **one module**, and the
database migration, validation, the profile form, the roster parser and the
eligibility rules are all derived from it. Adding a field is one edit, not five
that then drift apart. Affordable precisely because profiles are off-chain.
