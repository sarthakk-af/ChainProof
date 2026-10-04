# ChainProof — Deployment Report

How ChainProof was put online: what runs where, why each piece is there, what went wrong along the way and how each problem was fixed, and how the live system is looked after.

For the copy-and-paste commands, see [DEPLOY.md](DEPLOY.md). This report is the record of *what was done and why*.

**Live at:** https://chainproof.duckdns.org
**Blockchain:** Polygon Amoy (public test network, chain ID 80002)
**Deployed:** 3 October 2026

---

## 1. What "deployed" means for this project

ChainProof has two parts that are deployed in completely different ways.

| Part | Where it lives | Can it be changed later? |
|---|---|---|
| **The smart contracts** — the rules and the permanent placement record | Polygon Amoy, a public blockchain | **No.** Deployed once; the code can never change. A new version means deploying new contracts. |
| **The application** — the website, the backend and its database | One AWS EC2 server | **Yes.** Updated whenever new code is pushed. |

So deployment was two jobs:

1. **Deploy the contracts, once.** Upload the four contracts to Amoy. They received permanent public addresses.
2. **Deploy the application.** Put the website and backend on a server, reachable at a domain over HTTPS, connected to those contracts.

---

## 2. The architecture

```
 A visitor's browser
        │  https://chainproof.duckdns.org
        ▼
 ┌──────────────────────── AWS EC2 server (Ubuntu) ───────────────────────┐
 │                                                                       │
 │  nginx  (ports 80 / 443, HTTPS certificate from Let's Encrypt)        │
 │    ├── /        → the website: built React files in /var/www/chainproof │
 │    └── /api/    → the backend on 127.0.0.1:4000                        │
 │                                                                       │
 │  backend  (Node.js 22, kept running by PM2)                           │
 │    ├── SQLite database  backend/data/chainproof.sqlite                │
 │    │     logins, names, roll numbers, resumes, applications,          │
 │    │     and a fast copy ("mirror") of the blockchain records         │
 │    └── signs transactions with each user's own (encrypted) wallet     │
 └────────────────────────────────┬──────────────────────────────────────┘
                                  │  JSON-RPC over HTTPS
                                  ▼
                     PublicNode (Polygon Amoy RPC endpoint)
                                  │
                                  ▼
                 Polygon Amoy blockchain — the 4 ChainProof contracts
```

**The split that matters:**

- **On the blockchain:** facts that must never change. Offers, acceptances, batch sizes and training sessions, signed by whoever owns each fact, and tied only to wallet addresses, never names.
- **In the database:** personal data. Names, emails and resumes must stay private and deletable, which a blockchain cannot offer.

---

## 3. Every component, and why it is there

| Component | What it does | Why this choice |
|---|---|---|
| **Polygon Amoy** | Public test blockchain that holds the contracts and records | Fully public and permanent like a real network, but its currency (POL) is free test money |
| **POL / gas** | The fee paid for every write to the blockchain | Comes free from faucets on a test network |
| **Faucet** | Website that hands out free test POL | How the deploy wallet was funded, 0.1 POL at a time |
| **Hardhat 2.28.6** | Compiles the contracts and uploads them (`npm run deploy:amoy`) | The project's contract toolchain; the version is pinned in `package-lock.json` |
| **RPC endpoint** | Web address the backend uses to read and write the blockchain | **PublicNode**: free, no account, allows 500-block event queries (see §6, incident 5) |
| **Polygonscan** | Public website for inspecting any address or transaction on Amoy | Lets anyone, faculty included, check the records independently of ChainProof |
| **AWS EC2** | A rented cloud computer that runs around the clock | Free tier for 12 months; full control of the server |
| **Elastic IP** | A fixed public address for that server | So the address survives restarts and the domain can point at it |
| **DuckDNS** | Free domain name, `chainproof.duckdns.org` | Free and simple, and works with HTTPS certificates |
| **nginx** | The web server: serves the website, and forwards `/api` to the backend | One domain for both halves, so the browser never makes a cross-site request |
| **Let's Encrypt / certbot** | Free HTTPS certificate, renewed automatically | Passwords travel encrypted; browsers show the padlock |
| **Node.js 22** | Runs the backend and builds the website | Current long-term-support release |
| **PM2** | Keeps the backend running, restarts it after a crash, starts it after a reboot | Standard process manager for Node.js |
| **SQLite** | The backend's database: one file on the server | Simple, needs no separate database server, and is enough for one college |
| **Swap (2 GB)** | Extra memory on disk | The server has 1 GB of RAM; installing and building need more |

---

## 4. The contracts on Polygon Amoy

| Contract | Address | What it enforces |
|---|---|---|
| `ActorRegistry` | [`0x6e3CDabC5CB3E1BE57D18a8F7D6B6e89BeC3f7a7`](https://amoy.polygonscan.com/address/0x6e3CDabC5CB3E1BE57D18a8F7D6B6e89BeC3f7a7) | Who is who; admission, suspension, batch sizes |
| `PlacementDrive` | [`0x8274938F947c4966dBafA7673C86E3386bF967FD`](https://amoy.polygonscan.com/address/0x8274938F947c4966dBafA7673C86E3386bF967FD) | A company's own drive terms; the college only hosts |
| `DriveOutcomes` | [`0x19071D8D4c7e3E06F8EAE88Cc3018E91e0e01444`](https://amoy.polygonscan.com/address/0x19071D8D4c7e3E06F8EAE88Cc3018E91e0e01444) | Only the company records stages; only the student accepts |
| `PreparationLog` | [`0x1675Cf70b09b58469E5e96Cc303Bcd90fBe48F78`](https://amoy.polygonscan.com/address/0x1675Cf70b09b58469E5e96Cc303Bcd90fBe48F78) | The college's training record, which can't be edited |

**Deployment facts:**

| | |
|---|---|
| Deployed at | 2026-10-03 19:14:28 UTC, block **49,232,429** |
| Deployer and platform verifier | `0x99CEA6c1d7561BC2152EF986943f310BBF9cb4F7` |
| Cost | **0.29 POL**. The wallet went from 1.20 to 0.91 POL. |

**Checked after deploying, directly on the public network:**

- all four contracts have code at their addresses;
- the verifier is the deploy wallet, the same key the backend uses for admin actions;
- `DriveOutcomes` points at the right `ActorRegistry` and `PlacementDrive`.

**Why the deploy wallet is also the verifier.** Deploying `ActorRegistry` makes the deploying address its *verifier*, the account that admits the college and can suspend accounts. The backend therefore signs those actions with the same key. Both read it from one setting, `DEPLOYER_PRIVATE_KEY`, so the two can never disagree. Before the configuration was consolidated (§5), they were different keys, and the backend would not have been able to create the college at all.

---

## 5. Preparing the code for a public network

Several things that work on a local test chain fail, or quietly misbehave, on a real one. These were fixed **before** deployment. Each is in the code and covered by tests.

### 5.1 One configuration file, one key

Settings were spread over three `.env` files, two of which disagreed: the deploy key and the backend's verifier key were different keys.

**Fix:** one `.env` at the project root, read by both Hardhat and the backend.
- A single switch, `NETWORK=localhost` or `NETWORK=amoy`, selects the chain.
- On a local chain no private keys are needed; the backend uses Hardhat's built-in account automatically.
- The frontend keeps its own tiny `frontend/.env` with only the backend's URL. Anything the website reads is visible to every visitor, so it must never share a file with secrets.

### 5.2 A cap on transaction fees

Amoy's node *suggested* a fee tip of 500–660 gwei, set by a few senders overpaying, while blocks were accepting transactions tipping 25 gwei. Following the suggestion would have:

- made deploying cost about **2.9 POL** (more than the wallet held), so it would have failed;
- made every student action cost more than the gas each account receives, so every action would have failed.

**Fix:** tips are capped at 50 gwei on non-local networks, which is twice the network minimum (`MAX_PRIORITY_FEE_GWEI`). This applies in Hardhat (for deploying) and in the backend (for every transaction). Deploying then cost 0.29 POL, and a student action costs under 0.008 POL.

### 5.3 Waiting for finality

On a public chain the newest blocks are provisional for a few seconds; occasionally the network replaces one. A record copied into the database too early could show something the chain no longer has, such as a student marked placed by an acceptance that never landed.

**Fix:** every write waits until Polygon reports its block as *finalized* before it is shown as done or mirrored. The backend's reader follows finalized blocks only. On Amoy this adds about 2–5 seconds per action (`WAIT_FOR_FINALITY`, on by default off a local chain).

### 5.4 Reading the chain within provider limits

The backend keeps a mirror of all blockchain events so pages load fast. Three changes made that mirror work on a public network:

- **Start at the deploy block** (`deployBlock`, recorded by `scripts/deploy.js`), not block 0, which is tens of millions of blocks back.
- **Read in chunks** (`INDEXER_BLOCK_RANGE`, default 500), because providers refuse wide queries.
- **One request per chunk** covering all four contracts, instead of fourteen (one per kind of event). See §6, incident 5.

### 5.5 Working behind nginx

- **`TRUST_PROXY=1`.** Behind nginx, every request appears to come from nginx itself, so all visitors shared one rate limit: after ten sign-ups the whole internet would have been locked out for fifteen minutes. With this setting the backend reads each visitor's real address.
- **`HOST=127.0.0.1`.** The backend accepts connections only from nginx on the same machine, never directly from the internet.
- **Request size limit raised to 1 MB.** A full 5,000-student roster upload is about 735 KB; the old 100 KB default would have refused rosters above roughly 700 students.

### 5.6 Security for a public site

- **Job descriptions are stored by the backend,** which writes their hash on-chain with each drive. Previously the browser uploaded them through Pinata, which shipped the Pinata key to every visitor.
- **The company website check reaches only the public internet.** It can no longer be pointed at the server's own internal addresses (server-side request forgery).
- **Baseline security headers** on every response.
- **`/health` no longer publishes the treasury wallet's address and balance.**
- **Admin sessions can be signed out,** and they end when `ADMIN_PASSWORD` changes.

### 5.7 Proven before going live

The full stack was run in an isolated sandbox: its own chain, database and port, with finality waiting on and 10-block query chunks. That run included:

- a complete placement season through the API;
- three live test suites: a whole season end to end, 134 hostile-input checks, and every field the screens read;
- a database wiped of its blockchain data, rebuilt from the chain, and confirmed identical to the original.

The sandbox caught one real bug before it reached the live site: a late duplicate event could reset an approved drive to "Proposed". Every mirrored value now ignores older events.

---

## 6. The deployment, as it happened

The server steps followed [DEPLOY.md](DEPLOY.md). Five problems came up along the way. Each is recorded here, because each is a mistake that is easy to repeat.

### The steps

1. **Created the EC2 server** (Ubuntu). The firewall allows SSH from one IP only, plus HTTP and HTTPS from anywhere. Ports 4000 and 8545 are never open. An Elastic IP is attached.
2. **Pointed `chainproof.duckdns.org`** at the Elastic IP. Checked: the domain resolves to the server.
3. **Installed the stack:** system updates, 2 GB of swap, Node.js 22, git, nginx, build tools, sqlite3, certbot and PM2.
4. **Downloaded the project** from GitHub and installed its packages.
5. **Copied the `.env`** from the development PC, then changed the server-specific lines: `NETWORK=amoy`, `HOST`, `TRUST_PROXY`, the HTTPS frontend URLs, and a new strong `ADMIN_PASSWORD`.
6. **Deployed the contracts** with `npm run deploy:amoy` (§4).
7. **Built the website** with `VITE_BACKEND_URL=https://chainproof.duckdns.org/api`, and copied it to `/var/www/chainproof`.
8. **Configured nginx** from `deploy/nginx-chainproof.conf`.
9. **Enabled HTTPS** with certbot. Plain `http://` now redirects to `https://`.
10. **Started the backend** with PM2 from `deploy/ecosystem.config.cjs`, and registered it to start on boot (`pm2 startup`, `pm2 save`).

### Incident 1: the wrong version of Hardhat

- **Symptom.** `npm run deploy:amoy` failed with *"Hardhat only supports ESM projects"*.
- **Cause.** That message comes from Hardhat **3**, but the project uses Hardhat **2**. On the server, `package.json` and `package-lock.json` had been modified, most likely by `npm audit fix --force` or `npm install <package>`, which upgraded Hardhat.
- **Fix.** Restore both files from git (`git restore package.json package-lock.json`), then reinstall exactly what the lock file pins (`npm ci`). This gives Hardhat 2.28.6.
- **Lesson.** On a server, only ever install with `npm ci`. Never run `npm audit fix --force`.

### Incident 2: a settings file the app couldn't read

- **Symptom.** The deploy failed with *"HH117: Empty string for network URL"*, although the `.env` contained the URL.
- **Cause.** The file had been edited with `sudo`, making it owned by `root` with private permissions. The project runs as the `ubuntu` user, couldn't read it, and silently saw no settings at all.
- **Fix.** `sudo chown ubuntu:ubuntu ~/ChainProof/.env`, then `chmod 600`.
- **Lesson.** Edit the `.env` without `sudo`.

### Incident 3: the settings file overwritten

- **Symptom.** Caught during a check. The main `.env` contained a single line, `VITE_BACKEND_URL=…`.
- **Cause.** `echo "VITE_BACKEND_URL=…" > .env` was run in the project root, not in `frontend/`. The `>` symbol replaces a file's entire contents.
- **Fix.** Copied the `.env` from the development PC again and re-applied the server-specific lines. Nothing had used the broken file, because the contracts had already been deployed.
- **Lesson.** Check the folder before any command that writes a file with `>`.

### Incident 4: a typo in a URL

- **Cause.** `FRONTEND_ORIGIN` read `http://` instead of `https://`.
- **Fix.** Corrected with one `sed` command. It was caught by printing the non-secret settings to check them before starting the backend.

### Incident 5: the RPC provider's query limit

- **Symptom.** The backend crashed on start and PM2 kept restarting it. The site showed *"Request failed: 502"*.
- **Cause.** The free Alchemy plan allows an event query to cover only **10 blocks**, and the backend asked for 2,000. Even with 10-block queries, making fourteen requests per chunk could have used up the free monthly allowance.
- **Fix, in two parts:**
  1. The backend now makes **one request per chunk** for all contracts, with configurable chunk size and polling interval. This was proven in the sandbox, including the rebuild check in §5.7.
  2. The server switched from Alchemy to **PublicNode** (`https://polygon-amoy-bor-rpc.publicnode.com`). It's free, needs no account, allows 500-block queries, and supports finality checks. Polygon's former public endpoint, `rpc-amoy.polygon.technology`, no longer resolves.
- **Lesson.** Check an RPC provider's limits before relying on it. They differ widely and are not obvious.

### The final checks, from outside the server

- `https://chainproof.duckdns.org/api/health` returns `{"status":"ok", …}` and reads the live Amoy chain.
- The website loads with a valid HTTPS certificate.
- `http://` redirects to `https://`.
- The backend log shows it following finalized blocks, with no errors.

---

## 7. How the live system is configured

The server's `.env` holds these settings. Secrets are omitted, and are never committed.

| Setting | Value on the server | Purpose |
|---|---|---|
| `NETWORK` | `amoy` | Selects the public test network |
| `AMOY_RPC_URL` | `https://polygon-amoy-bor-rpc.publicnode.com` | Where the backend reads and writes the chain |
| `DEPLOYER_PRIVATE_KEY` | *(secret)* | Deploys the contracts; the verifier and gas treasury |
| `JWT_SECRET`, `WALLET_ENCRYPTION_KEY` | *(secret)* | Sign sessions; encrypt every user's wallet key |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | *(secret)* | The `/admin` login |
| `HOST` | `127.0.0.1` | Backend reachable only through nginx |
| `TRUST_PROXY` | `1` | Real visitor addresses for rate limits |
| `FRONTEND_URL`, `FRONTEND_ORIGIN` | `https://chainproof.duckdns.org` | Password-reset links and allowed origin |
| `BREVO_API_KEY`, `EMAIL_FROM_*` | *(secret)* | Sending sign-up codes and password resets |

These defaults switch on automatically off a local chain and don't need setting: finality waiting, the 50-gwei fee cap, and a 0.04 POL gas grant per account, sent when it first acts on the blockchain. The website's `frontend/.env` holds only `VITE_BACKEND_URL=https://chainproof.duckdns.org/api`.

---

## 8. Running costs

| Item | Cost |
|---|---|
| Deploying the contracts (once) | 0.29 test POL |
| Each account (gas it is given at its first blockchain action, after confirming its email) | 0.04 test POL |
| Each user action (from that account's gas) | under 0.008 test POL |
| AWS EC2 | Free tier for 12 months; watch the billing page, including the public-IP charge |
| Domain (DuckDNS), HTTPS (Let's Encrypt), RPC (PublicNode) | Free |

Test POL has no monetary value. The only constraint is keeping the deploy wallet topped up from a faucet. The admin page shows how many more sign-ups it can fund.

---

## 9. Looking after it

**Updating the live site after pushing new code** (on the server):

```bash
cd ~/ChainProof && git pull --ff-only
cd backend && npm ci && cd ..
cd frontend && npm ci && npm run build && sudo cp -r dist/. /var/www/chainproof/ && cd ..
pm2 restart chainproof-backend
```

**Backing up the database,** which holds every login and profile:

```bash
mkdir -p ~/backups
sqlite3 ~/ChainProof/backend/data/chainproof.sqlite ".backup '$HOME/backups/chainproof-$(date +%F).sqlite'"
```

**Checking on it:**
- `pm2 status`: is the backend running?
- `pm2 logs chainproof-backend`: what is it doing?
- `sudo tail /var/log/nginx/error.log`: nginx's own errors.

**What must be kept safe off the server:**
- the SSH key (`.pem`);
- the `.env`;
- the four contract addresses (§4).

With those, the server can be rebuilt from scratch.

**What must never be done:**
- run `npm run deploy:amoy` again (it creates new, empty contracts);
- open port 4000 to the internet;
- run more than one copy of the backend (the database and transaction queue assume one);
- commit the `.env`;
- edit the `.env` with `sudo`;
- run `npm audit fix --force` on the server.

---

## 10. Moving to a new version of the contracts

Deployed contracts can never be modified; that is the point of them. A version 2 is a **new deployment**:

- New contracts receive new addresses. The backend switches to them by reading the new `deployment.js` that the deploy writes.
- The old contracts and every record in them stay on Amoy permanently, and can still be inspected on Polygonscan.
- Logins and profiles carry over, because they live in the database. Blockchain records start fresh on the new contracts.
- It costs about 0.3 test POL.

"Upgradeable" contracts (proxies) exist, but whoever holds the upgrade key could then rewrite the rules, which would undo what ChainProof promises. A fresh deployment is the honest way to change the rules.

---

## 11. Known limits of the live system

- **The server holds every user's wallet key,** so that users need no crypto wallet. The blockchain proves which *wallet* signed a record, not which person. Whoever operates the server could, in principle, sign as any user. Letting users hold their own keys would remove this, at the cost of needing a wallet.
- **One server.** If it is down, the site is down, although the records on Polygon Amoy remain public and intact. Restoring means rebuilding the server from the items in §9.
- **A public RPC provider.** PublicNode is free and shared. If it is ever unavailable, any other Amoy RPC endpoint can be set in `AMOY_RPC_URL`, with `INDEXER_BLOCK_RANGE` matched to its limits.
