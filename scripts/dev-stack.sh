#!/usr/bin/env bash
# The whole thing, locally: Postgres, the API, the web app -- with bulk
# generation working, which needs all three.
#
#   scripts/dev-stack.sh        start everything
#   scripts/dev-stack.sh stop   stop everything
#
# The web app only shows "Generate from data" when it has an API to talk
# to (NEXT_PUBLIC_API_URL); without one it runs on browser storage alone
# and bulk generation is not offered at all.
#
# Servers are detached from the shell that starts them, so closing the
# terminal does not take them with it.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGS="${TMPDIR:-/tmp}/pdfslot-dev"
mkdir -p "$LOGS"

if [ "${1:-}" = "stop" ]; then
  pkill -f 'nitro dev' 2>/dev/null || true
  pkill -f 'next dev -p 5173' 2>/dev/null || true
  docker rm -f pdfslot-pg > /dev/null 2>&1 || true
  echo "stopped"
  exit 0
fi

if ! docker ps --filter name=pdfslot-pg --format '{{.Names}}' | grep -q pdfslot-pg; then
  echo "starting Postgres..."
  docker run --rm -d --name pdfslot-pg -e POSTGRES_PASSWORD=pw -p 55432:5432 postgres:17 > /dev/null
  for _ in $(seq 1 30); do
    docker exec pdfslot-pg pg_isready -U postgres > /dev/null 2>&1 && break
    sleep 1
  done
  docker exec pdfslot-pg psql -U postgres -c "CREATE DATABASE pdfslot" > /dev/null 2>&1 || true
  (cd "$ROOT/apps/api" && npm run db:migrate > "$LOGS/migrate.log" 2>&1) && echo "migrations applied"
fi

pkill -f 'nitro dev' 2>/dev/null || true
pkill -f 'next dev -p 5173' 2>/dev/null || true
sleep 2

cd "$ROOT/apps/api"
setsid nohup npm run dev > "$LOGS/api.log" 2>&1 < /dev/null &
cd "$ROOT/apps/web"
NEXT_PUBLIC_API_URL=http://localhost:3000 setsid nohup npx next dev -p 5173 > "$LOGS/web.log" 2>&1 < /dev/null &

for _ in $(seq 1 40); do
  api=$(curl -s -m 2 -o /dev/null -w "%{http_code}" http://localhost:3000/health 2>/dev/null || true)
  web=$(curl -s -m 2 -o /dev/null -w "%{http_code}" http://localhost:5173/ 2>/dev/null || true)
  if [ "$api" = "200" ] && [ "$web" = "200" ]; then
    echo
    echo "  http://localhost:5173"
    echo "  API key for generating: $(grep '^API_KEY=' "$ROOT/apps/api/.env" | cut -d= -f2-)"
    echo
    echo "  logs: $LOGS"
    exit 0
  fi
  sleep 3
done
echo "did not come up: api=${api:-} web=${web:-}; see $LOGS"
exit 1
