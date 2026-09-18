# Live attack suites

Three scripts that drive the real HTTP API against a running stack and try to
make the system do something it shouldn't.

```
npm run test:attacks
```

## Why these are separate from `npm test`

`npm test` is 187 unit and route tests that run against a temporary SQLite file
with nothing else switched on. These are different: they need all three
services up, they write real transactions to the chain, and they create real
accounts. Mixing the two would mean `npm test` could only ever be run by
someone with the full stack running, which defeats the point of it.

## What they cover

| Script | Journey |
|---|---|
| `v2-journey.mjs` | A whole placement season: the owner creates the college → cohort and roster → students claim roll numbers (both orderings) → a company is admitted and posts its own terms → applications and the CGPA cutoff → the funnel → offers answered → the public page → a withdrawn offer → a revised cohort size |
| `hostile-input.mjs` | Forged tokens, injection, garbage types, malformed bodies, prototype pollution, URLs that shouldn't answer |
| `ui-contract.mjs` | Every field the dashboards actually read, checked against the live API. Needs a seeded database (`npm run seed:full`) |

Each prints `PASS` / `FAIL` per check and exits non-zero if anything fails.

What `v2-journey.mjs` is really checking is that the numbers on the public page
could not have been produced by anyone who shouldn't have produced them: the
college can't post a drive, can't publish the applicant count, and can't record
an outcome; the company can't answer an offer on a student's behalf; and the
placed count only moves when a student says yes.

## Before running

1. `npx hardhat node` (repo root)
2. `npm run deploy:local` (repo root)
3. `npm start` (backend) — see below
4. `ADMIN_USERNAME` / `ADMIN_PASSWORD` set in `backend/.env`. The journey suite
   signs in as the platform owner to create the college, because that is now the
   only way a college comes into existence — there is no self-registration for
   one.

The runner checks the backend is reachable first and tells you what to start if
it isn't.

Re-running against the same database is fine. The college is a singleton, so
the suite re-uses the one already there (resetting its password through the
owner's break-glass route) and works in a fresh batch year each run — placement
figures are aggregated per batch year, so sharing one would have each run
counting the last one's offers.

## Run the backend WITHOUT the file watcher

Use `npm start`, not `npm run dev`.

`npm run dev` runs `node --watch`, which restarts the server on its own while a
suite is mid-flight. The restart shows up as `ECONNREFUSED` on every subsequent
check — indistinguishable from the server having crashed, which is the one
failure these suites exist to detect. Chasing that took a while precisely
because it looks so much like a real finding.

## A note on what they leave behind

These create accounts, registrations and drives in the dev database, and spend
test gas. That's deliberate — a test that cleans up after itself can't prove the
state it created was correct. To start fresh, stop the backend, delete
`backend/data/chainproof.sqlite`, restart the chain and redeploy.

Some suites create enough accounts to trip the signup rate limiter, so they
create users through the same internals `/auth/signup` uses rather than over
HTTP. That limiter is verified separately in `npm test` — it isn't being
skipped, just kept out of the way of the thing under test.
