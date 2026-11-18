import { timingSafeEqual } from "node:crypto";

const QUERY_KEYS = new Set(["token", "access_token", "api_key", "apikey"]);

export type AuthResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

export function queryCarriesToken(url: URL): boolean {
  for (const key of url.searchParams.keys()) {
    if (QUERY_KEYS.has(key.toLowerCase())) return true;
  }
  return false;
}

export function checkAuth(authorization: string | undefined, token: string): AuthResult {
  if (!authorization?.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "No autorizado." };
  }
  const presented = authorization.slice("Bearer ".length);
  if (!safeEqual(presented, token)) return { ok: false, status: 401, error: "No autorizado." };
  return { ok: true };
}

function safeEqual(presented: string, expected: string): boolean {
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    timingSafeEqual(right, right);
    return false;
  }
  return timingSafeEqual(left, right);
}
