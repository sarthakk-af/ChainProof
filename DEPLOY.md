# Deploying ChainProof

This puts the whole app on one AWS EC2 server: the website and the backend both run there, on one free domain, with HTTPS. The blockchain is Polygon Amoy, Polygon's public test network.

Go through the steps in order. Each one says where to type the commands, **your PC** or **the server**. Wherever you see `YOUR_DOMAIN`, use your real domain, for example `chainproof.duckdns.org`.

```
visitor ──https──▶ nginx ──┬──▶ the website (built files)        for  /
                           └──▶ the backend (PM2, port 4000)      for  /api
                                      │
                                      ▼
                              Polygon Amoy (blockchain)
```

---

## 0. Before you start (your PC)

- **All your latest code is pushed to GitHub.** The server downloads the project from there.
- **An Amoy RPC endpoint in `AMOY_RPC_URL`.** PublicNode is free and needs no account: `https://polygon-amoy-bor-rpc.publicnode.com`. Alchemy's free plan works too, but only allows 10-block event queries. With it, also set `INDEXER_BLOCK_RANGE=10`, or the backend fails at start with a "block range" error.
- **Your deploy wallet has test POL.** Deploying costs about **0.3 POL**, and each user then gets **0.04 POL** for their own actions, sent when they first act on the blockchain (after confirming their email). If it runs low, get more from a Polygon Amoy faucet. Check the balance by searching your deploy address on [amoy.polygonscan.com](https://amoy.polygonscan.com).
- **Optional: a free Etherscan API key** from [etherscan.io/myapikey](https://etherscan.io/myapikey). It lets anyone check that the contracts on Polygonscan are exactly the code in this repository.

## 1. Create the server (AWS console)

1. Go to EC2 and choose **Launch instance**:
   - Image: **Ubuntu Server 24.04 LTS**
   - Type: **t3.micro** (or t2.micro), on the free tier
   - Key pair: create one and download the `.pem` file. You need it to log in, and AWS can't give it to you again.
   - Storage: **20 GB**
2. **Security group (the firewall).** Allow only these:
   - SSH, port 22, from **My IP**
   - HTTP, port 80, from anywhere
   - HTTPS, port 443, from anywhere

   **Don't open port 4000 or 8545.** The backend must only be reachable through nginx.
3. **Elastic IPs → Allocate → Associate** it with the instance. This gives the server an address that doesn't change when it restarts.

## 2. Get a free domain

1. Sign in at [duckdns.org](https://www.duckdns.org).
2. Create a subdomain, for example `chainproof`, which gives you `chainproof.duckdns.org`.
3. Set its IP to your Elastic IP.

## 3. Prepare the server (the server)

Log in from your PC:

```bash
ssh -i path/to/your-key.pem ubuntu@YOUR_ELASTIC_IP
```

Then on the server:

```bash
# 2 GB of swap: the server has 1 GB of memory, and building the website needs more.
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Node.js 22, plus everything else the app needs.
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git nginx build-essential python3 sqlite3 certbot python3-certbot-nginx
sudo npm install -g pm2
```

## 4. Download the project (the server)

```bash
git clone https://github.com/sarthakk-af/ChainProof.git
cd ChainProof
npm install
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
```

## 5. Settings (your PC, then the server)

Copy your `.env` from your PC to the server. Run this **on your PC**, from the project folder:

```bash
scp -i path/to/your-key.pem .env ubuntu@YOUR_ELASTIC_IP:~/ChainProof/.env
```

Then **on the server**, open it with `nano ~/ChainProof/.env` and change these lines:

```
NETWORK=amoy
HOST=127.0.0.1
TRUST_PROXY=1
FRONTEND_URL=https://YOUR_DOMAIN
FRONTEND_ORIGIN=https://YOUR_DOMAIN
ETHERSCAN_API_KEY=        (your key, if you got one)
```

Save with Ctrl+O, Enter, then Ctrl+X. Then make the file private:

```bash
chmod 600 ~/ChainProof/.env
```

Leave `JWT_SECRET` and `WALLET_ENCRYPTION_KEY` exactly as they are. Changing `WALLET_ENCRYPTION_KEY` makes every user's wallet unreadable.

The server starts with an **empty database**, which is correct. Your local data belongs to your local test chain, and none of it exists on Amoy.

## 6. Put the contracts on the blockchain, once (the server)

```bash
cd ~/ChainProof
npm run deploy:amoy
```

This costs about 0.3 POL. It prints four contract addresses and saves them to `frontend/src/contracts/deployment.js`.

**Keep a copy of that file.** It's the backend's only record of where your contracts are. Run this on your PC:

```bash
scp -i path/to/your-key.pem ubuntu@YOUR_ELASTIC_IP:~/ChainProof/frontend/src/contracts/deployment.js ./amoy-deployment.js
```

**Run `deploy:amoy` only once.** Running it again creates brand-new, empty contracts, and every college, drive and placement recorded so far would no longer show in the app.

**Optional: publish the contract code on Polygonscan.** This needs `ETHERSCAN_API_KEY`. Use the addresses the deploy printed, and your deploy wallet's address:

```bash
npx hardhat verify --network amoy ACTOR_REGISTRY_ADDRESS DEPLOYER_ADDRESS
npx hardhat verify --network amoy PLACEMENT_DRIVE_ADDRESS ACTOR_REGISTRY_ADDRESS
npx hardhat verify --network amoy DRIVE_OUTCOMES_ADDRESS ACTOR_REGISTRY_ADDRESS PLACEMENT_DRIVE_ADDRESS
npx hardhat verify --network amoy PREPARATION_LOG_ADDRESS ACTOR_REGISTRY_ADDRESS
```

## 7. Build the website (the server)

```bash
cd ~/ChainProof
echo "VITE_BACKEND_URL=https://YOUR_DOMAIN/api" > frontend/.env
cd frontend && npm run build && cd ..
sudo mkdir -p /var/www/chainproof
sudo cp -r frontend/dist/. /var/www/chainproof/
```

## 8. nginx (the server)

```bash
sudo cp deploy/nginx-chainproof.conf /etc/nginx/sites-available/chainproof
sudo sed -i 's/YOUR_DOMAIN/chainproof.duckdns.org/g' /etc/nginx/sites-available/chainproof   # your domain
sudo ln -s /etc/nginx/sites-available/chainproof /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

`nginx -t` must say *syntax is ok* and *test is successful*.

## 9. HTTPS (the server)

```bash
sudo certbot --nginx -d YOUR_DOMAIN
```

Enter your email and agree to the terms. Certbot adds HTTPS to the nginx config and renews the certificate automatically.

## 10. Start the backend (the server)

```bash
cd ~/ChainProof
pm2 start deploy/ecosystem.config.cjs
pm2 logs chainproof-backend          # wait for "listening on", then Ctrl+C
pm2 save
pm2 startup                          # then run the one command it prints
```

`pm2 startup` makes the backend start again by itself whenever the server reboots.

## 11. Check it works

1. `https://YOUR_DOMAIN/api/health` should show `"status":"ok"`.
2. `https://YOUR_DOMAIN` should show the website.
3. At `https://YOUR_DOMAIN/admin`, sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD` and **create the college**. This writes to the blockchain, so give it a few seconds.

   Expect every action that writes to the blockchain to take a few seconds longer than it does locally. The app waits until the network has made each one final before calling it done.
4. Sign up as a student with an email you can open, and check the 6-digit code arrives. If it doesn't, the sender address in `EMAIL_FROM_ADDRESS` isn't verified in Brevo yet.

---

## Afterwards

**Updating the app after you push new code:**

```bash
cd ~/ChainProof && git pull
cd backend && npm install && cd ..
cd frontend && npm install && npm run build && sudo cp -r dist/. /var/www/chainproof/ && cd ..
pm2 restart chainproof-backend
```

**Backing up the database.** It holds every login and profile. Run this whenever you like, for example weekly:

```bash
mkdir -p ~/backups
sqlite3 ~/ChainProof/backend/data/chainproof.sqlite ".backup '$HOME/backups/chainproof-$(date +%F).sqlite'"
```

Keep `.env` and your copy of `deployment.js` on your PC too. Without them the server can't be rebuilt.

**Gas.** The admin page shows how many sign-ups the deploy wallet can still pay for. Top it up from a faucet before it runs out.

**If something is wrong:**
- `pm2 logs chainproof-backend` shows the backend's own explanation.
- `sudo tail /var/log/nginx/error.log` shows nginx's.

**Never:**
- open port 4000 to the internet;
- run more than one copy of the backend;
- run `deploy:amoy` a second time;
- commit `.env`.
