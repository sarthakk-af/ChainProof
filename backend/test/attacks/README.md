# Live attack suites

Six scripts that drive the real HTTP API against a running stack and try to
make the system do something it shouldn't.

```
npm run test:attacks
```

## Why these are separate from `npm test`

`npm test` is 93 unit and route tests that run against an in-memory database
with nothing else switched on. These are different: they need all three
services up, they write real transactions to the chain, and they create real
accounts. Mixing the two would mean `npm test` could only ever be run by
someone with the full stack running, which defeats the point of it.

## What they cover

| Script | Journey |
|---|---|
| `e2e.mjs` | The full story: signup → OTP → registration → admin approval → join code → student → offer → public dashboard → rescind |
| `flow2-attack.mjs` | Claiming an identity — concurrency, CIN uniqueness, role confusion, hostile input |
| `flow3-attack.mjs` | Getting verified — admin auth, decision replay, audit-log attribution |
| `flow4-attack.mjs` | A college's placement cell — join codes, issuance boundaries, self-issued placements |
| `flow5-attack.mjs` | A company hiring — idempotency, correction authority, the two-offer case |
| `flow7-attack.mjs` | The public surface — what a stranger can and cannot read |
| `hostile-input.mjs` | Forged tokens, injection, garbage types, malformed bodies, URLs that shouldn't answer |

Each prints `PASS` / `FAIL` per check and exits non-zero if anything fails.
Findings and reasoning behind each check are in `FLOW_AUDIT.md` §5.

## Before running

1. All three services up — see `TEST_PLAN.md` Part 0.
2. An admin account named `sarthak` with password `AdminPass123`
   (`TEST_PLAN.md` §0.4). Several suites need it to approve registrations.

The runner checks the backend is reachable first and tells you what to start
if it isn't.

**Signup is rate-limited per IP** (10 per 15 minutes), and the full journey
suite needs three real signups. If you have been hammering `/auth/signup`,
restart the backend to clear the in-memory counter before running. The journey
suite says so explicitly rather than failing in a confusing way.

## A note on what they leave behind

These create accounts, registrations and credentials in the dev database, and
spend test gas. That's deliberate — a test that cleans up after itself can't
prove the state it created was correct. To start fresh, wipe the database and
restart the chain (`TEST_PLAN.md` §0.3).

Some suites create enough accounts to trip the signup rate limiter, so they
create users through the same internals `/auth/signup` uses rather than over
HTTP. That limiter is verified separately in `npm test` — it isn't being
skipped, just kept out of the way of the thing under test.
