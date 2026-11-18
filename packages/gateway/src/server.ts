import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { addChannel, CatalogError, importM3u, removeChannel } from "@bootlyga/domain";
import { checkAuth, queryCarriesToken } from "./auth.ts";
import { createCatalogStore, type CatalogStore } from "./catalogStore.ts";
import type { Config } from "./config.ts";
import { applyCors } from "./cors.ts";
import { createEngine, type Engine } from "./engine.ts";
import { HttpError } from "./errors.ts";
import { rewritePlaylist } from "./hls.ts";
import { log } from "./log.ts";
import { isSafeEnginePath, isUuid } from "./paths.ts";
import { createSessions, type SessionManager } from "./sessions.ts";
import { serveStatic } from "./static.ts";

const TOKEN_IN_QUERY = "La clave no se acepta en la query. Usa la cabecera Authorization: Bearer.";

export type AppDeps = {
  engine?: Engine;
  sessions?: SessionManager;
  catalog?: CatalogStore;
};

export function createApp(config: Config, deps: AppDeps = {}) {
  const engine = deps.engine ?? createEngine(config.aceBase);
  const sessions = deps.sessions ?? createSessions({
    engine,
    clock: config.clock,
    maxSessions: config.maxSessions,
    maxViewers: config.maxViewers,
    ttlMs: config.ttlMs,
  });
  const catalog = deps.catalog ?? createCatalogStore(config.catalogPath);
  let probeAt = Number.NEGATIVE_INFINITY;
  let probeValue = { ok: false, version: null as string | null };

  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message });
        return;
      }
      if (error instanceof CatalogError) {
        sendJson(res, error.code === "duplicate" ? 409 : 400, { error: error.message });
        return;
      }
      log("error", "petición fallida", { message: error instanceof Error ? error.message : "error" });
      sendJson(res, 500, { error: "Error interno." });
    });
  });

  server.on("close", () => sessions.dispose());

  async function engineStatus() {
    const now = config.clock.now();
    if (now - probeAt < 2_000) return probeValue;
    probeValue = await engine.probe();
    probeAt = now;
    return probeValue;
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    security(res);
    const url = new URL(req.url ?? "/", "http://gateway.local");
    if (queryCarriesToken(url)) {
      sendJson(res, 400, { error: TOKEN_IN_QUERY });
      return;
    }
    if (applyCors(req, res, config.corsOrigins)) return;

    if (req.method === "GET" && url.pathname === "/health/live") {
      sendJson(res, 200, { status: "live" });
      return;
    }
    if (req.method === "GET" && (url.pathname === "/health/ready" || url.pathname === "/health")) {
      const engineState = await engineStatus();
      const body = {
        status: engineState.ok ? "ok" : "degraded",
        engine: engineState,
        stats: sessions.stats(),
        ts: new Date().toISOString(),
      };
      if (url.pathname === "/health/ready") {
        sendJson(res, engineState.ok ? 200 : 503, body);
        return;
      }
      sendJson(res, 200, body);
      return;
    }

    if (url.pathname.startsWith("/v1/")) {
      const auth = checkAuth(req.headers.authorization, config.token);
      if (!auth.ok) {
        sendJson(res, auth.status, { error: auth.error });
        return;
      }
      if (await routeApi(req, res, url)) return;
      sendJson(res, 404, { error: "No existe." });
      return;
    }

    if (req.method === "GET" && config.webRoot) {
      const served = await serveStatic(config.webRoot, url.pathname, res);
      if (served) return;
    }
    sendJson(res, 404, { error: "No existe." });
  }

  async function routeApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (req.method === "GET" && url.pathname === "/v1/stats") {
      sendJson(res, 200, sessions.stats());
      return true;
    }
    if (req.method === "GET" && url.pathname === "/v1/catalog") {
      sendJson(res, 200, await catalog.read());
      return true;
    }
    if (req.method === "POST" && url.pathname === "/v1/channels") {
      const body = await readJson(req);
      const value = await catalog.change((current) => {
        const added = addChannel(current, {
          name: stringField(body.name),
          group: optionalString(body.group),
          acestreamId: firstString(body.acestreamId, body.aceId),
          quality: optionalString(body.quality),
          label: optionalString(body.label),
        });
        return { catalog: added.catalog, value: added };
      });
      sendJson(res, 201, value);
      return true;
    }
    if (req.method === "POST" && url.pathname === "/v1/import/m3u") {
      const body = await readJson(req);
      const text = stringField(body.text);
      const value = await catalog.change((current) => {
        const imported = importM3u(current, text);
        return { catalog: imported.catalog, value: imported };
      });
      sendJson(res, 200, value);
      return true;
    }
    if (req.method === "POST" && url.pathname === "/v1/sessions") {
      const body = await readJson(req);
      const aceId = firstString(body.aceId, body.acestreamId);
      const session = await sessions.open(aceId);
      sendJson(res, 201, session);
      return true;
    }

    const channel = /^\/v1\/channels\/([^/]+)$/.exec(url.pathname);
    if (req.method === "DELETE" && channel?.[1]) {
      if (!isUuid(channel[1])) throw new HttpError(400, "Identificador de canal no válido.");
      const value = await catalog.change((current) => {
        const next = removeChannel(current, channel[1] as string);
        return { catalog: next, value: next };
      });
      sendJson(res, 200, value);
      return true;
    }

    const force = /^\/v1\/sessions\/([^/]+)\/force$/.exec(url.pathname);
    if (req.method === "DELETE" && force?.[1]) {
      await sessions.forceStop(decodeURIComponent(force[1]));
      sendJson(res, 200, { ok: true });
      return true;
    }
    const release = /^\/v1\/sessions\/([^/]+)$/.exec(url.pathname);
    if (req.method === "DELETE" && release?.[1]) {
      const body = await readJson(req);
      const playbackId = stringField(body.playbackId);
      if (!playbackId) throw new HttpError(400, "Falta playbackId.");
      await sessions.release(decodeURIComponent(release[1]), playbackId);
      sendJson(res, 200, { ok: true });
      return true;
    }

    const manifest = /^\/v1\/hls\/([^/]+)\/index\.m3u8$/.exec(url.pathname);
    if (req.method === "GET" && manifest?.[1]) {
      if (!isUuid(manifest[1])) throw new HttpError(404, "No hay esa sesión.");
      await proxyManifest(res, manifest[1]);
      return true;
    }
    const media = /^\/v1\/hls\/([^/]+)\/media$/.exec(url.pathname);
    if (req.method === "GET" && media?.[1]) {
      if (!isUuid(media[1])) throw new HttpError(404, "No hay esa sesión.");
      await proxyMedia(req, res, media[1], url);
      return true;
    }
    return false;
  }

  async function proxyManifest(res: ServerResponse, sessionId: string) {
    const session = await sessions.touch(sessionId);
    if (!session) throw new HttpError(404, "No hay esa sesión.");
    const upstream = await engine.fetch(session.handle.playbackPath, {
      signal: AbortSignal.any([session.controller.signal, clientGone(res)]),
    });
    const text = await upstream.text();
    if (upstream.status !== 200 || !text.includes("#EXTM3U")) {
      res.writeHead(503, {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "retry-after": "1",
      });
      res.end("buscando pares");
      return;
    }
    const body = rewritePlaylist(text, session.sessionId, session.handle.playbackPath);
    res.writeHead(200, {
      "content-type": "application/vnd.apple.mpegurl",
      "cache-control": "no-store",
    });
    res.end(body);
  }

  async function proxyMedia(req: IncomingMessage, res: ServerResponse, sessionId: string, url: URL) {
    const mediaPath = url.searchParams.get("path") ?? "";
    if (!isSafeEnginePath(mediaPath.split("?")[0] ?? "")) throw new HttpError(400, "Ruta no permitida.");
    const session = await sessions.touch(sessionId);
    if (!session) throw new HttpError(404, "No hay esa sesión.");
    const upstream = await engine.fetch(mediaPath, {
      signal: AbortSignal.any([session.controller.signal, clientGone(res)]),
      range: headerOne(req.headers.range),
    });
    const type = upstream.contentType ?? "";
    if (mediaPath.includes(".m3u8") || /mpegurl/i.test(type)) {
      const text = await upstream.text();
      if (!text.includes("#EXTM3U")) {
        res.writeHead(503, {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
          "retry-after": "1",
        });
        res.end("buscando pares");
        return;
      }
      const body = rewritePlaylist(text, session.sessionId, mediaPath);
      res.writeHead(200, {
        "content-type": "application/vnd.apple.mpegurl",
        "cache-control": "no-store",
      });
      res.end(body);
      return;
    }
    res.writeHead(upstream.status, {
      "content-type": type || "application/octet-stream",
      "cache-control": "no-store",
    });
    if (!upstream.stream) {
      res.end();
      return;
    }
    await pipeline(Readable.fromWeb(upstream.stream as never), res);
  }

  return server;
}

function security(res: ServerResponse) {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader(
    "content-security-policy",
    [
      "default-src 'self'",
      "script-src 'self' blob:",
      "style-src 'self'",
      "font-src 'self' data:",
      "img-src 'self' data:",
      "connect-src 'self'",
      "media-src 'self' blob:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  );
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
    "cache-control": "no-store",
  });
  res.end(data);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_000_000) {
        fail(new HttpError(413, "El cuerpo es demasiado grande."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", fail);
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const text = await readBody(req);
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("no");
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "JSON no válido.");
  }
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function headerOne(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function clientGone(res: ServerResponse): AbortSignal {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller.signal;
}
