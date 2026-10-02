#!/usr/bin/env bash
# Run one SQL statement against the database over Neon's HTTP endpoint,
# using curl.
#
# Why curl and not the driver: on some networks Node's HTTP client cannot
# reach this host while curl can -- same address, same TLS -- so the
# driver fails with a connect timeout that looks like a dead database.
# This keeps a way in that does not depend on which client is used.
#
# DATABASE_URL is read from the environment and passed to curl as a
# header; it is never printed.
#
# Usage: DATABASE_URL=... scripts/neon-sql.sh "select 1"
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is not set}"
query="${1:?usage: neon-sql.sh \"<sql>\"}"

host="$(printf '%s' "$DATABASE_URL" | sed -E 's#^[^@]*@([^/?]+).*#\1#')"

body="$(QUERY="$query" python3 -c '
import json, os
print(json.dumps({"query": os.environ["QUERY"], "params": []}))
')"

curl -sS -m 30 \
  -H "Neon-Connection-String: $DATABASE_URL" \
  -H "Neon-Raw-Text-Output: true" \
  -H "Neon-Array-Mode: false" \
  -H "Content-Type: application/json" \
  -X POST "https://$host/sql" \
  -d "$body"
