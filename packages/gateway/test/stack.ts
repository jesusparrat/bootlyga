import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { startMock, type MockSnapshot } from "../../mock-engine/src/server.ts";
import { manualClock } from "../src/clock.ts";
import { loadConfig } from "../src/config.ts";
import { createApp } from "../src/server.ts";

export const TOKEN = "test-token-value";

export function ace(char: string): string {
  if (!/^[a-f0-9]$/.test(char)) throw new Error("char");
  return char.repeat(40);
}

export async function startStack(opts: {
  ttlMs?: number;
  maxSessions?: number;
  maxViewers?: number;
  origins?: string;
} = {}) {
  const clock = manualClock(1_000_000);
  const mock = await startMock();
  const dir = await mkdtemp(path.join(tmpdir(), "bootlyga-"));
  const catalogPath = path.join(dir, "catalog.json");
  const config = loadConfig({
    BOOTLYGA_TOKEN: TOKEN,
    ACE_BASE: mock.url,
    CATALOG_PATH: catalogPath,
    SESSION_TTL_MS: String(opts.ttlMs ?? 300_000),
    MAX_P2P_SESSIONS: String(opts.maxSessions ?? 5),
    MAX_VIEWERS_PER_SESSION: String(opts.maxViewers ?? 10),
    BOOTLYGA_CORS_ORIGINS: opts.origins ?? "",
    NODE_ENV: "test",
  }, clock);
  const server = createApp(config);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    clock,
    mock,
    base: `http://127.0.0.1:${port}`,
    catalogPath,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await mock.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}`, ...extra };
}

export async function openSession(base: string, aceId: string) {
  const response = await fetch(`${base}/v1/sessions`, {
    method: "POST",
    headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify({ aceId }),
  });
  const body = await response.json() as { sessionId: string; playbackId: string; manifestUrl: string; error?: string };
  return { response, body };
}

export async function stats(base: string) {
  const response = await fetch(`${base}/v1/stats`, { headers: headers() });
  return response.json() as Promise<{ activeSessions: number; sessions: { viewers: number; aceId: string }[] }>;
}

export function engineLeaked(snapshot: MockSnapshot, body: string): boolean {
  return body.includes(":6878") || body.includes("acestream");
}
