import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { describe, it } from "node:test";
import { emptyCatalog, parseCatalog } from "@bootlyga/domain";
import { loadConfig } from "../src/config.ts";
import { createEngine } from "../src/engine.ts";
import { HttpError } from "../src/errors.ts";
import { rewritePlaylist } from "../src/hls.ts";
import { ace, headers, openSession, startStack, stats, TOKEN } from "./stack.ts";

describe("auth y cors", () => {
  it("rechaza la clave en la query y no abre sin cabecera", async () => {
    const stack = await startStack();
    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      const health = await fetch(`${stack.base}/health?token=${TOKEN}`);
      assert.equal(health.status, 400);
      const leaked = await fetch(`${stack.base}/v1/stats?token=${TOKEN}`, { headers: headers() });
      assert.equal(leaked.status, 400);
      const missing = await fetch(`${stack.base}/v1/stats`);
      assert.equal(missing.status, 401);
      const wrong = await fetch(`${stack.base}/v1/stats`, { headers: { authorization: "Bearer no-es" } });
      assert.equal(wrong.status, 401);
      const ok = await fetch(`${stack.base}/v1/stats`, { headers: headers() });
      assert.equal(ok.status, 200);
      assert.equal(logs.some((line) => line.includes(TOKEN)), false);
      const ready = await fetch(`${stack.base}/health/ready`);
      assert.equal(ready.status, 200);
      const live = await (await fetch(`${stack.base}/health`)).json() as { engine: { version: string } };
      assert.equal(live.engine.version, "mock-1");
    } finally {
      console.log = original;
      await stack.close();
    }
  });

  it("el origen permitido se refleja y el resto no, nunca con asterisco", async () => {
    const stack = await startStack({ origins: "https://salon.casa" });
    try {
      const allowed = await fetch(`${stack.base}/health`, { headers: { origin: "https://salon.casa" } });
      assert.equal(allowed.headers.get("access-control-allow-origin"), "https://salon.casa");
      const denied = await fetch(`${stack.base}/health`, { headers: { origin: "https://otro.example" } });
      assert.equal(denied.headers.get("access-control-allow-origin"), null);
      const preflight = await fetch(`${stack.base}/v1/stats`, { method: "OPTIONS", headers: { origin: "https://otro.example" } });
      assert.equal(preflight.status, 403);
      assert.equal(preflight.headers.get("access-control-allow-origin"), null);
    } finally {
      await stack.close();
    }
  });

  it("un asterisco en la configuración no arranca", () => {
    assert.throws(() => loadConfig({ BOOTLYGA_TOKEN: "x", BOOTLYGA_CORS_ORIGINS: "*" }), /no admite/);
  });

  it("el token de CI y los de ejemplo se rechazan en producción", () => {
    assert.throws(
      () => loadConfig({ NODE_ENV: "production", BOOTLYGA_TOKEN: "ci-bootlyga-token-018" }),
      /ejemplo/,
    );
    const ok = loadConfig({ NODE_ENV: "production", BOOTLYGA_TOKEN: "clave-real-de-casa-123456" });
    assert.equal(ok.token, "clave-real-de-casa-123456");
  });

  it("/health y /health/ready no exponen stats ni aceId sin autenticación", async () => {
    const stack = await startStack();
    try {
      const id = ace("f");
      const opened = await openSession(stack.base, id);
      assert.equal(opened.response.status, 201);

      for (const route of ["/health", "/health/ready"]) {
        const response = await fetch(`${stack.base}${route}`);
        assert.equal(response.status, 200);
        const text = await response.text();
        assert.equal(text.includes(id), false);
        const body = JSON.parse(text) as Record<string, unknown>;
        assert.equal("stats" in body, false);
      }

      const authStats = await stats(stack.base);
      assert.equal(authStats.activeSessions, 1);
      assert.equal(authStats.sessions[0]?.aceId, id);
    } finally {
      await stack.close();
    }
  });
});

describe("proxy", () => {
  it("reescribe absolutas, relativas y descarta un host externo", () => {
    const playlist = [
      "#EXTM3U",
      "#EXTINF:2,",
      "http://127.0.0.1:6878/ace/c/abc/0.ts",
      "#EXTINF:2,",
      "http://acestream:6878/ace/c/abc/1.ts",
      "#EXTINF:2,",
      "../../c/abc/2.ts",
      "#EXTINF:2,",
      "http://evil.example/steal.ts",
      '#EXT-X-MEDIA:URI="http://127.0.0.1:6878/ace/m/abc/sub.m3u8"',
    ].join("\n");
    const session = "11111111-1111-4111-8111-111111111111";
    const rewritten = rewritePlaylist(playlist, session, "/ace/m/abc/token.m3u8");
    assert.equal(rewritten.includes("6878"), false);
    assert.equal(rewritten.includes("evil.example"), false);
    assert.equal(rewritten.includes("acestream"), false);
    assert.equal(rewritten.includes(`/v1/hls/${session}/media?path=`), true);
    assert.equal(rewritten.includes(encodeURIComponent("/ace/c/abc/2.ts")), true);
  });

  it("al borrar la sesión el manifiesto deja de servirse", async () => {
    const stack = await startStack();
    try {
      const opened = await openSession(stack.base, ace("b"));
      await fetch(`${stack.base}/v1/sessions/${ace("b")}`, {
        method: "DELETE",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({ playbackId: opened.body.playbackId }),
      });
      const gone = await fetch(`${stack.base}${opened.body.manifestUrl}`, { headers: headers() });
      assert.equal(gone.status, 404);
    } finally {
      await stack.close();
    }
  });

  it("al apagar el gateway se paran las sesiones activas en el motor", async () => {
    const stack = await startStack();
    try {
      await openSession(stack.base, ace("a"));
      await openSession(stack.base, ace("b"));
      assert.equal(stack.mock.snapshot().active.length, 2);

      await stack.shutdown();

      const snap = stack.mock.snapshot();
      assert.equal(snap.active.length, 0);
      assert.equal(snap.stops.length, 2);
    } finally {
      await stack.close();
    }
  });

  it("engine.fetch corta con 504 si el motor no responde a tiempo", async () => {
    const sockets = new Set<import("node:net").Socket>();
    const slow = createServer((_req, _res) => {
      // mantiene la petición colgada a propósito
    });
    slow.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => slow.listen(0, "127.0.0.1", resolve));
    const port = (slow.address() as AddressInfo).port;
    try {
      const engine = createEngine(`http://127.0.0.1:${port}`, { fetchTimeoutMs: 80 });
      await assert.rejects(
        () => engine.fetch("/ace/c/slow/0.ts", {}),
        (error: unknown) => error instanceof HttpError && error.status === 504,
      );
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => slow.close(() => resolve()));
    }
  });

  it("e2e-stack.sh no sobrescribe .env ni fija el token de CI", async () => {
    const script = await readFile(path.resolve(import.meta.dirname, "../../../scripts/e2e-stack.sh"), "utf8");
    assert.equal(/>\s*\.env\b/.test(script), false);
    assert.equal(script.includes("ci-bootlyga-token-018"), false);
  });
});

describe("catálogo", () => {
  it("guarda un canal de la persona y no pierde el evento", async () => {
    const stack = await startStack();
    try {
      const { writeFile } = await import("node:fs/promises");
      const seeded = {
        ...emptyCatalog(),
        events: [{
          id: "22222222-2222-4222-8222-222222222222",
          sport: "f1",
          competition: "F1",
          title: "Carrera",
          home: null,
          away: null,
          startsAt: "2026-07-15T18:00:00.000Z",
          timeKnown: true,
          durationEstMin: 120,
          broadcasters: ["emisora"],
          source: "manual",
          confidence: "confirmed",
        }],
      };
      await writeFile(stack.catalogPath, JSON.stringify(seeded));
      const created = await fetch(`${stack.base}/v1/channels`, {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({ name: "Carrera de prueba", group: "Fórmula 1", acestreamId: ace("c"), quality: "FHD" }),
      });
      assert.equal(created.status, 201);
      const read = await fetch(`${stack.base}/v1/catalog`, { headers: headers() });
      const catalog = parseCatalog(await read.json());
      assert.equal(catalog.channels[0]?.name, "Carrera de prueba");
      assert.equal(catalog.sources[0]?.quality, "FHD");
      assert.equal(catalog.events[0]?.startsAt, "2026-07-15T18:00:00.000Z");
      assert.equal(catalog.events[0]?.timeKnown, true);
    } finally {
      await stack.close();
    }
  });
});
