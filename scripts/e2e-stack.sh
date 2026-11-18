#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

token="${BOOTLYGA_TOKEN:-ci-bootlyga-token-018}"
gateway="${GATEWAY_URL:-http://127.0.0.1:8080}"

printf 'BOOTLYGA_TOKEN=%s\n' "$token" > .env

if docker info >/dev/null 2>&1; then
  compose=(docker compose)
else
  compose=(sudo docker compose)
fi

cleanup() {
  "${compose[@]}" --project-directory "$root" down --volumes >/dev/null 2>&1 || true
}
trap cleanup EXIT

"${compose[@]}" --project-directory "$root" down --volumes >/dev/null 2>&1 || true
"${compose[@]}" --project-directory "$root" up -d --build

if ! BOOTLYGA_TOKEN="$token" GATEWAY_URL="$gateway" node scripts/wait-ready.mjs; then
  echo "compose: el gateway no alcanza el motor; probando la pila en el host" >&2
  "${compose[@]}" down --volumes >/dev/null 2>&1 || true
  exec "$root/scripts/e2e-host.sh"
fi

BOOTLYGA_TOKEN="$token" GATEWAY_URL="$gateway" node scripts/smoke.mjs

PLAYWRIGHT_BASE_URL="$gateway" BOOTLYGA_TOKEN="$token" npx playwright test