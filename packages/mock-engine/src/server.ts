import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

export type MockSnapshot = {
  active: string[];
  opens: { aceId: string; useApiStop: boolean }[];
  stops: { aceId: string }[];
};

type Stream = {
  aceId: string;
  token: string;
  playlistReads: number;
};

const defaultFixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");

export function createMock(opts: { fixturesDir?: string } = {}) {
  const fixturesDir = opts.fixturesDir ?? process.env.FIXTURES_DIR ?? defaultFixtures;
  const segments = [
    readFileSync(path.join(fixturesDir, "seg0.ts")),
    readFileSync(path.join(fixturesDir, "seg1.ts")),
  ];
  const streams = new Map<string, Stream>();
  const opens: { aceId: string; useApiStop: boolean }[] = [];
  const stops: { aceId: string }[] = [];
  const startedAt = Date.now();

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://mock.local");
    try {
      route(req, res, url);
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(error instanceof Error ? error.message : "error");
    }
  });

  function route(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (req.method === "GET" && url.pathname === "/webui/api/service") {
      json(res, 200, { error: null, result: { platform: "mock", version: "mock-1", code: 1 } });
      return;
    }
    if (req.method === "GET" && url.pathname === "/ace/manifest.m3u8") {
      const aceId = (url.searchParams.get("id") ?? "").toLowerCase();
      if (!/^[a-f0-9]{40}$/.test(aceId)) {
        json(res, 400, { error: "id", response: null });
        return;
      }
      const stream = openStream(aceId, url.searchParams.get("use_api_stop") === "1");
      const host = req.headers.host ?? "127.0.0.1";
      json(res, 200, {
        error: null,
        response: {
          playback_url: `http://${host}/ace/m/${aceId}/${stream.token}.m3u8`,
          stat_url: `http://${host}/ace/stat/${aceId}/${stream.token}`,
          command_url: `http://${host}/ace/cmd/${aceId}/${stream.token}`,
          infohash: aceId,
          playback_session_id: stream.token,
          is_live: 1,
        },
      });
      return;
    }
    const playlist = /^\/ace\/m\/([a-f0-9]{40})\/([a-f0-9]+)\.m3u8$/.exec(url.pathname);
    if (req.method === "GET" && playlist) {
      const stream = streams.get(playlist[1] ?? "");
      if (!stream || stream.token !== playlist[2]) {
        res.writeHead(404);
        res.end();
        return;
      }
      stream.playlistReads += 1;
      if (stream.aceId.startsWith("11111111") && stream.playlistReads <= 2) {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
        res.end("buscando");
        return;
      }
      const host = req.headers.host ?? "127.0.0.1";
      res.writeHead(200, {
        "content-type": "application/vnd.apple.mpegurl",
        "cache-control": "no-store",
      });
      res.end(livePlaylist(host, stream.aceId, startedAt));
      return;
    }
    const segment = /^\/ace\/c\/([a-f0-9]{40})\/(\d+)\.ts$/.exec(url.pathname);
    if (req.method === "GET" && segment) {
      const stream = streams.get(segment[1] ?? "");
      if (!stream) {
        res.writeHead(404);
        res.end();
        return;
      }
      const index = Number(segment[2]) % 2;
      const body = segments[index] ?? segments[0];
      res.writeHead(200, {
        "content-type": "video/mp2t",
        "content-length": body.length,
        "cache-control": "no-store",
      });
      res.end(body);
      return;
    }
    const command = /^\/ace\/cmd\/([a-f0-9]{40})\/([a-f0-9]+)$/.exec(url.pathname);
    if (req.method === "GET" && command && url.searchParams.get("method") === "stop") {
      const stream = streams.get(command[1] ?? "");
      if (stream && stream.token === command[2]) {
        streams.delete(stream.aceId);
        stops.push({ aceId: stream.aceId });
      }
      json(res, 200, { response: "ok", error: null });
      return;
    }
    const stat = /^\/ace\/stat\/([a-f0-9]{40})\/([a-f0-9]+)$/.exec(url.pathname);
    if (req.method === "GET" && stat) {
      const stream = streams.get(stat[1] ?? "");
      if (!stream || stream.token !== stat[2]) {
        json(res, 404, { error: "no session", response: null });
        return;
      }
      json(res, 200, { error: null, response: { status: "dl", peers: 1, downloaded: 1 } });
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("no");
  }

  function openStream(aceId: string, useApiStop: boolean): Stream {
    const existing = streams.get(aceId);
    if (existing) return existing;
    const stream = { aceId, token: randomBytes(8).toString("hex"), playlistReads: 0 };
    streams.set(aceId, stream);
    opens.push({ aceId, useApiStop });
    return stream;
  }

  return {
    server,
    snapshot(): MockSnapshot {
      return {
        active: [...streams.keys()],
        opens: opens.map((item) => ({ ...item })),
        stops: stops.map((item) => ({ ...item })),
      };
    },
  };
}

export async function startMock(opts: { fixturesDir?: string } = {}) {
  const mock = createMock(opts);
  await new Promise<void>((resolve) => mock.server.listen(0, "127.0.0.1", resolve));
  const address = mock.server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    port: address.port,
    snapshot: () => mock.snapshot(),
    close() {
      return new Promise<void>((resolve, reject) => {
        mock.server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

function livePlaylist(host: string, infohash: string, startedAt: number): string {
  const seq = Math.floor((Date.now() - startedAt) / 2_000);
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-TARGETDURATION:2",
    `#EXT-X-MEDIA-SEQUENCE:${seq}`,
  ];
  for (let offset = 0; offset < 3; offset += 1) {
    const number = seq + offset;
    lines.push("#EXTINF:2.000,", `http://${host}/ace/c/${infohash}/${number}.ts`);
  }
  return `${lines.join("\n")}\n`;
}

function json(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
    "cache-control": "no-store",
  });
  res.end(data);
}
