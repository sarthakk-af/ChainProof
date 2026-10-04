#!/usr/bin/env bash
# Updates the live server to the latest code on main.
#
#   bash ~/ChainProof/deploy/update.sh
#
# Run on the server, by hand or by the deploy job in .github/workflows/ci.yml.
# The same steps DEPLOY.md lists for an update: pull, reinstall packages only
# where their lock file changed, rebuild the website, restart the backend, and
# check it came back up. Stops at the first failure, leaving the running site
# as it was until the restart.

set -euo pipefail

# Everything is inside a function so bash reads the whole script before running
# any of it. `git pull` below can replace this very file, and bash otherwise
# keeps reading a script from disk as it goes.
main() {
  cd "$(dirname "$0")/.."

  local before
  before="$(git rev-parse HEAD)"
  git pull --ff-only

  if [ "$(git rev-parse HEAD)" = "$before" ]; then
    echo "Already up to date — nothing to do."
    return 0
  fi

  local changed
  changed="$(git diff --name-only "$before" HEAD)"
  echo "Updating $(git rev-parse --short "$before") → $(git rev-parse --short HEAD)"

  # `npm ci` installs exactly what the lock file pins. Never `npm install` or
  # `npm audit fix` here: that is how Hardhat 3 once ended up on this server.
  if grep -q '^package-lock.json$' <<<"$changed"; then
    echo "→ root packages changed, reinstalling"
    npm ci
  fi
  if grep -q '^backend/package-lock.json$' <<<"$changed"; then
    echo "→ backend packages changed, reinstalling"
    (cd backend && npm ci)
  fi
  if grep -q '^frontend/package-lock.json$' <<<"$changed"; then
    echo "→ frontend packages changed, reinstalling"
    (cd frontend && npm ci)
  fi

  echo "→ building the website"
  (cd frontend && npm run build)
  sudo cp -r frontend/dist/. /var/www/chainproof/

  echo "→ restarting the backend"
  pm2 restart chainproof-backend

  # The backend takes a few seconds to start: it reads the chain before it
  # listens. Thirty seconds without an answer means something is wrong.
  for _ in $(seq 1 15); do
    if curl -fsS http://127.0.0.1:4000/health >/dev/null 2>&1; then
      echo "✓ Deployed $(git rev-parse --short HEAD), and the backend is healthy."
      return 0
    fi
    sleep 2
  done

  echo "✗ The backend did not answer /health after the restart. Recent logs:" >&2
  pm2 logs chainproof-backend --lines 40 --nostream >&2 || true
  return 1
}

main "$@"
