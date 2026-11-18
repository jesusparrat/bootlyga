#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

token="${BOOTLYGA_TOKEN:-ci-bootlyga-token-018}"
gateway="${GATEWAY_URL:-http://127.0.0.1:8080}"
tmpdir="$(mktemp -d)"
catalog="$tmpdir/catalog.json"
printf '{ "version": 1, "channels": [], "sources": [], "events": [] }\n' >"$catalog"

cleanup() {
  jobs -p | xargs -r kill 2>/dev/null || true
  rm -rf "$tmpdir"
}
trap cleanup EXIT

HOST=127.0.0.1 PORT=6878 FIXTURES_DIR="$root/packages/mock-engine/fixtures" node packages/mock-engine/dist/server.js &
mock_pid=$!

HOST=127.0.0.1 PORT=8080 NODE_ENV=production BOOTLYGA_TOKEN="$token" ACE_BASE=http://127.0.0.1:6878 \
  WEB_ROOT="$root/apps/web/dist" CATALOG_PATH="$catalog" MAX_P2P_SESSIONS=5 MAX_VIEWERS_PER_SESSION=10 SESSION_TTL_MS=300000 \
  node packages/gateway/dist/server.js &
gateway_pid=$!

sleep 1
if ! kill -0 "$mock_pid" 2>/dev/null || ! kill -0 "$gateway_pid" 2>/dev/null; then
  echo "no arrancó la pila en el host" >&2
  exit 1
fi

BOOTLYGA_TOKEN="$token" GATEWAY_URL="$gateway" node scripts/wait-ready.mjs
BOOTLYGA_TOKEN="$token" GATEWAY_URL="$gateway" node scripts/smoke.mjs

PLAYWRIGHT_BASE_URL="$gateway" BOOTLYGA_TOKEN="$token" npx playwright test