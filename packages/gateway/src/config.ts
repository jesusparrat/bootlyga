import { systemClock, type Clock } from "./clock.ts";

const EXAMPLE_TOKENS = new Set([
  "cambia-esto-por-una-clave-larga",
  "changeme-dev-token",
  "ci-bootlyga-token-018",
]);

export type SecureCookieMode = "auto" | "true" | "false";

export type Config = {
  host: string;
  port: number;
  token: string;
  aceBase: string;
  maxSessions: number;
  maxViewers: number;
  ttlMs: number;
  hlsCookieTtlSec: number;
  secureCookie: SecureCookieMode;
  corsOrigins: string[];
  webRoot: string | null;
  catalogPath: string;
  nodeEnv: string;
  clock: Clock;
};

export function loadConfig(env: NodeJS.ProcessEnv, clock: Clock = systemClock()): Config {
  const token = env.BOOTLYGA_TOKEN ?? "";
  if (!token) throw new Error("BOOTLYGA_TOKEN es obligatorio.");
  const nodeEnv = env.NODE_ENV ?? "development";
  if (nodeEnv === "production") {
    if (token.length < 16) throw new Error("BOOTLYGA_TOKEN es demasiado corto para producción.");
    if (EXAMPLE_TOKENS.has(token)) throw new Error("BOOTLYGA_TOKEN de ejemplo no vale en producción.");
  }
  const corsOrigins = (env.BOOTLYGA_CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (corsOrigins.includes("*")) throw new Error("BOOTLYGA_CORS_ORIGINS no admite *.");
  for (const origin of corsOrigins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`Origen CORS no válido: ${origin}`);
    }
    if (parsed.origin !== origin) throw new Error(`Origen CORS no válido: ${origin}`);
  }
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1) throw new Error("PORT no válido.");
  return {
    host: env.HOST ?? "127.0.0.1",
    port,
    token,
    aceBase: (env.ACE_BASE ?? "http://127.0.0.1:6878").replace(/\/$/, ""),
    maxSessions: positive(env.MAX_P2P_SESSIONS, 5),
    maxViewers: positive(env.MAX_VIEWERS_PER_SESSION, 10),
    ttlMs: positive(env.SESSION_TTL_MS, 300_000),
    hlsCookieTtlSec: positive(env.HLS_COOKIE_TTL_SEC, 14_400),
    secureCookie: parseSecureCookie(env.BOOTLYGA_SECURE_COOKIE),
    corsOrigins,
    webRoot: env.WEB_ROOT ? env.WEB_ROOT : null,
    catalogPath: env.CATALOG_PATH ?? "data/catalog.json",
    nodeEnv,
    clock,
  };
}

function parseSecureCookie(value: string | undefined): SecureCookieMode {
  if (value == null || value === "") return "auto";
  const normalized = value.trim().toLowerCase();
  if (normalized === "auto" || normalized === "true" || normalized === "false") return normalized;
  throw new Error("BOOTLYGA_SECURE_COOKIE solo admite auto, true o false.");
}

function positive(value: string | undefined, fallback: number): number {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error("Límite numérico no válido.");
  return parsed;
}
