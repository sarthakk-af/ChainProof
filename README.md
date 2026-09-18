# ChainProof

An internal placement platform for one college, where every placement figure is recorded on a blockchain by the party with nothing to gain from inflating it.

- **Companies** post their own drives and record each candidate's stage, including offers.
- **Students** accept or decline their own offers. Nobody counts as placed until they accept.
- **The college** declares its batch sizes, admits the companies that recruit on campus, and records the training it ran.
- **The public**, including parents, can check it all on a dashboard with no login and no student names.

Once written, none of those records can be edited — not even by the administrator.

For a plain-language explanation, see [TEACHER_OVERVIEW.md](TEACHER_OVERVIEW.md). For how it works under the hood, see [TECHNICAL_REPORT.md](TECHNICAL_REPORT.md). For the agreed design and the reasoning behind it, see [SPEC.md](SPEC.md).

## How it's put together

```
Browser (React)  →  Backend (Node/Express + SQLite)  →  Blockchain (Solidity)
   frontend/                 backend/                       contracts/
```

- **`contracts/`** — four smart contracts, tested with Hardhat:
  - `ActorRegistry` — who is who, admission, suspension, batch sizes.
  - `PlacementDrive` — the drives companies post.
  - `DriveOutcomes` — each candidate's stage, offer answers, and who is placed.
  - `PreparationLog` — the college's training sessions.
- **`backend/`** — hides the blockchain from users. It handles email/password login, keeps an encrypted wallet for every user and signs on their behalf, and mirrors on-chain events into SQLite for fast reads. It also holds everything personal (names, roll numbers, resumes), which never goes on-chain.
- **`frontend/`** — the website. It has dashboards for students, the college, companies and the administrator, plus the public dashboard.

## Running it locally

You need Node.js 20 or later. Install dependencies once:

```bash
npm install                      # repo root (contracts)
cd backend && npm install
cd ../frontend && npm install
```

Copy `backend/.env.example` to `backend/.env` and fill it in. At minimum, set `ADMIN_PASSWORD`: it becomes the password for the `admin` login.

Then start everything, **in this order, each in its own terminal**:

```bash
# 1. A local blockchain (keep it running)
npx hardhat node

# 2. Deploy the contracts to it (runs once, then exits)
npm run deploy:local

# 3. The backend (keep it running) — use `npm start`, not `npm run dev`
cd backend && npm start

# 4. The frontend (keep it running)
cd frontend && npm run dev
```

Open **http://localhost:5173**. The system starts empty, and you set it up by hand:

1. Go to **http://localhost:5173/admin**, sign in as `admin`, and create the college. This also creates the placement cell's login.
2. Sign in as the college. Declare a batch size and upload the roster (roll numbers, names, course, batch).
3. Sign up as a company. The college approves it, and it can then post a drive.
4. Sign up as a student and enter a roll number from the roster.
5. The public placement results are at **http://localhost:5173/results**.

If you'd rather have ready-made demo data: `cd backend && npm run seed:full`.

### Things that trip people up

- **Restarting the blockchain wipes it.** After restarting step 1, run step 2 again and restart the backend. The backend notices the new deployment and clears its copy of the old chain data. Logins are kept.
  - Everything recorded on the old chain is gone, so each existing login picks its role again, and the admin creates the college again (the placement cell keeps its login). Wallets are refilled with test ETH automatically.
  - If you forget step 2, the backend won't start, and a running backend stops accepting requests. Either way it prints what to do.
- **"Port already in use"** means an earlier copy is still running. The backend now refuses to start in that case and tells you so. To stop the old copy on Windows:
  ```
  netstat -ano | findstr :4000
  taskkill /PID <number> /F
  ```
- **Use `npm run seed:full`, not `npm run seed -- --full`.** PowerShell drops the `--`.
- **Email codes:** without `BREVO_API_KEY` in `backend/.env`, no email is actually sent. Signing up still works, but the email address can't be confirmed, and a student needs a confirmed email to be verified.

### Looking at the database

Everything the backend stores is one file: `backend/data/chainproof.sqlite`. Open it with **DB Browser for SQLite**, or the **SQLite Viewer** extension in VS Code. Use read-only mode while the backend is running.

## Tests

```bash
npx hardhat test                  # 213 contract tests
cd backend && npm test            # 177 backend tests (no blockchain needed)
cd frontend && npm run lint       # frontend lint
```

With the full stack running (and `npm run seed:full` for the last suite), there are also three live suites that drive the real API:

```bash
cd backend && npm run test:attacks
```

They cover a full placement season end to end, hostile input (forged tokens, injection, malformed requests), and a check of every field the dashboards read. They add test accounts to your database, so don't run them on data you want to keep.

## Current status

**Built and tested:**
- student sign-up and verification by roll number
- resumes and skills
- anonymous company browsing, with contact details unlocked only when a student applies
- drives, stages and offers
- the college's batch sizes and preparation record
- placement notices
- the administrator's account controls
- the public dashboard

**Not done yet:**
- **Public deployment.** Everything runs on a local blockchain. Deploying to Polygon Amoy (a public test network) is the next step.
- **Before deploying:** job-description documents are currently uploaded to IPFS (via Pinata) from the browser, which means the Pinata key is included in the website's code. Uploads need to move to the backend, and the key needs replacing, before the site is public.
