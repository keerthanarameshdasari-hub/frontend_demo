#!/usr/bin/env bash
# Starts backend_demo on a macOS runner without Docker (GitHub's macOS runners have none):
# Postgres from Homebrew, moto as the S3 stand-in, and the API itself with Node.
#   scripts/e2e/start-backend-macos.sh <backend_demo checkout>
# Leaves the API on http://localhost:3000. Logs go to e2e-results/ios/backend-*.log.
set -euo pipefail

BACKEND="$(cd "$1" && pwd)"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOGS="$ROOT/e2e-results/ios"
mkdir -p "$LOGS"

brew install --quiet postgresql@17
PG="$(brew --prefix postgresql@17)/bin"
DATA="$RUNNER_TEMP/pgdata"
"$PG/initdb" -D "$DATA" -U wallet --auth=trust >/dev/null
"$PG/pg_ctl" -D "$DATA" -o "-p 5432 -k $RUNNER_TEMP" -l "$LOGS/backend-postgres.log" -w start
"$PG/createdb" -h 127.0.0.1 -p 5432 -U wallet wallet

python3 -m venv "$RUNNER_TEMP/moto"
"$RUNNER_TEMP/moto/bin/pip" install --quiet 'moto[server]==5.2.5'
"$RUNNER_TEMP/moto/bin/moto_server" -H 127.0.0.1 -p 9000 > "$LOGS/backend-s3.log" 2>&1 &

cd "$BACKEND"
# Same values as docker compose, with the hosts pointed at this machine.
sed -e 's#^DATABASE_URL=.*#DATABASE_URL=postgresql://wallet@127.0.0.1:5432/wallet?schema=public#' \
    -e 's#^S3_ENDPOINT=.*#S3_ENDPOINT=http://127.0.0.1:9000#' \
    .env.example > .env
set -a
# shellcheck disable=SC1091 # written just above
. ./.env
set +a

npm ci --no-audit --no-fund
npx prisma migrate deploy
npm run build
for _ in $(seq 1 30); do curl -fsS -o /dev/null http://127.0.0.1:9000/ && break; sleep 1; done
node dist/scripts/ensure-bucket.js
PORT=3000 nohup node dist/main.js > "$LOGS/backend-api.log" 2>&1 &

for _ in $(seq 1 60); do
  if curl -fsS http://localhost:3000/ready >/dev/null 2>&1; then
    curl -fsS http://localhost:3000/meta/min-app-version; echo
    exit 0
  fi
  sleep 2
done
echo "backend_demo did not become ready"; tail -50 "$LOGS/backend-api.log"; exit 1
