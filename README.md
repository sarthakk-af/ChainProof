# ChainProof

ChainProof proves that a college's student-placement statistics are real. Instead of a college self-reporting numbers, every step of the process — a student registering, a company issuing an offer, a college announcing a recruiting visit — is written permanently to a blockchain by the party actually doing it. Nobody can quietly inflate a placement percentage after the fact, and anyone can check the real numbers on the public dashboard without an account.

## How it's put together

Three pieces, each with its own folder:

- **`contracts/`** — the actual blockchain layer (Solidity, tested with Hardhat). `ActorRegistry.sol` handles registration and verifies Colleges/Companies before they're trusted; `CredentialIssuer.sol` records credentials and computes per-college placement percentages; `PlacementTracker.sol` records company-visit announcements.
- **`backend/`** — a Node/Express service that makes the blockchain invisible to end users. It runs normal email/password login, holds an encrypted blockchain wallet for every user and signs transactions on their behalf, keeps a fast local (SQLite) mirror of on-chain events for quick reads, and runs the admin verification queue.
- **`frontend/`** — the React/Vite website: sign-in, role selection, the three role dashboards (Student/College/Company), the admin panel, and the public accountability dashboard.

## Running it locally

Everything currently runs on your own machine against a private practice blockchain (not deployed anywhere public yet). Four things need to run, in this order, each in its own terminal:

```bash
# 1. A local blockchain
npx hardhat node

# 2. Deploy the contracts to it (writes addresses/ABIs to frontend/src/contracts/deployment.js)
npx hardhat run scripts/deploy.js --network localhost

# 3. The backend (see backend/.env.example for required environment variables)
cd backend && npm install && npm run dev

# 4. The frontend
cd frontend && npm install && npm run dev
```

Then open `http://localhost:5173`. The admin verification queue is at `/admin` (needs the `ADMIN_API_KEY` from `backend/.env`), and the public dashboard is at `/public` (no login needed).

Password-reset emails go through [Brevo](https://www.brevo.com) (free tier). Without `BREVO_API_KEY`/`EMAIL_FROM_ADDRESS` set in `backend/.env`, "Forgot password?" still works from the user's point of view (same response either way, so it can't be used to check which emails are registered) — it just won't actually send anything, which is logged as an error server-side.

### Running the tests

```bash
npx hardhat test        # smart contracts
cd backend && npm test  # backend
```

## Current status

**Done:** the full flow above — sign up, register a role, admin approval, issuing credentials, announcing visits, the public dashboard, password reset, and real logout (signing out actually invalidates the session, not just clears it locally) — is built and tested (contract + backend automated tests, plus manual browser verification).

**Not done yet, on purpose:**
- **Deployment.** Everything only runs on `localhost` right now — nobody outside this machine can use it. Moving to a public testnet (and hosting the backend/frontend somewhere reachable) is the next planned step.
- **Real document storage.** Credential titles/descriptions currently only persist in the browser tab that created them (a placeholder), not on real decentralized storage (IPFS) — deliberately deferred.
