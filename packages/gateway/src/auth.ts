import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const QUERY_KEYS = new Set(["token", "access_token", "api_key", "apikey"]);
export const HLS_COOKIE_NAME = "bootlyga_hls";

export type AuthResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

export type HlsCookieSigner = {
  issue(nowMs: number, ttlSec: number): string;
  verify(cookieHeader: string | undefined, nowMs: number): boolean;
};

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

export function createHlsCookieSigner(token: string): HlsCookieSigner {
  const salt = randomBytes(32);
  const key = createHmac("sha256", salt).update(token).digest();

  function sign(payloadB64: string): string {
    return createHmac("sha256", key).update(payloadB64).digest("base64url");
  }

  return {
    issue(nowMs, ttlSec) {
      const payload = Buffer.from(JSON.stringify({ exp: nowMs + ttlSec * 1_000 }), "utf8").toString("base64url");
      return `${payload}.${sign(payload)}`;
    },

    verify(cookieHeader, nowMs) {
      const raw = readCookie(cookieHeader, HLS_COOKIE_NAME);
      if (!raw) return false;
      const dot = raw.indexOf(".");
      if (dot <= 0 || dot !== raw.lastIndexOf(".")) return false;
      const payload = raw.slice(0, dot);
      const signature = raw.slice(dot + 1);
      if (!signature) return false;
      const expected = sign(payload);
      if (!safeEqual(signature, expected)) return false;
      try {
        const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
        return typeof parsed.exp === "number" && Number.isFinite(parsed.exp) && parsed.exp > nowMs;
      } catch {
        return false;
      }
    },
  };
}

export function formatHlsSetCookie(value: string, opts: { maxAge: number; secure: boolean }): string {
  const parts = [
    `${HLS_COOKIE_NAME}=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/v1/hls/",
    `Max-Age=${Math.max(0, Math.floor(opts.maxAge))}`,
  ];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearHlsSetCookie(secure: boolean): string {
  return formatHlsSetCookie("", { maxAge: 0, secure });
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return part.slice(eq + 1).trim();
  }
  return null;
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
