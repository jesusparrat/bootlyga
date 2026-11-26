#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

token="${BOOTLYGA_TOKEN:-$(node --input-type=module -e "import { randomBytes } from 'node:crypto'; console.log(randomBytes(24).toString('hex'))")}"
gateway="${GATEWAY_URL:-http://127.0.0.1:8080}"
project="bootlyga-e2e"
tmp_env="$(mktemp)"

printf 'BOOTLYGA_TOKEN=%s\n' "$token" > "$tmp_env"

if docker info >/dev/null 2>&1; then
  compose=(docker compose)
elif command -v sudo >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1; then
  compose=(sudo docker compose)
else
  echo "compose: Docker no está disponible; probando la pila en el host" >&2
  rm -f "$tmp_env"
  exec env BOOTLYGA_TOKEN="$token" GATEWAY_URL="$gateway" "$root/scripts/e2e-host.sh"
fi

cleanup() {
  "${compose[@]}" -p "$project" --env-file "$tmp_env" --project-directory "$root" down --volumes >/dev/null 2>&1 || true
  rm -f "$tmp_env"
}
trap cleanup EXIT

"${compose[@]}" -p "$project" --env-file "$tmp_env" --project-directory "$root" down --volumes >/dev/null 2>&1 || true
"${compose[@]}" -p "$project" --env-file "$tmp_env" --project-directory "$root" up -d --build

if ! BOOTLYGA_TOKEN="$token" GATEWAY_URL="$gateway" node scripts/wait-ready.mjs; then
  echo "compose: el gateway no alcanza el motor; probando la pila en el host" >&2
  "${compose[@]}" -p "$project" --env-file "$tmp_env" --project-directory "$root" down --volumes >/dev/null 2>&1 || true
  rm -f "$tmp_env"
  exec env BOOTLYGA_TOKEN="$token" GATEWAY_URL="$gateway" "$root/scripts/e2e-host.sh"
fi

BOOTLYGA_TOKEN="$token" GATEWAY_URL="$gateway" node scripts/smoke.mjs

PLAYWRIGHT_BASE_URL="$gateway" BOOTLYGA_TOKEN="$token" npx playwright test