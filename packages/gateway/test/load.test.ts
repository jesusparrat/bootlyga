import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ace, headers, openSession, startStack, stats } from "./stack.ts";

describe("iptv-player#1", () => {
  it("cambio rápido: cinco canales seguidos dejan una sola sesión y paran el anterior", async () => {
    const stack = await startStack();
    try {
      const ids = ["a", "b", "c", "d", "e"].map(ace);
      const started = Date.now();
      let playback = "";
      for (const id of ids) {
        if (playback) {
          const released = await fetch(`${stack.base}/v1/sessions/${playback.split(" ")[0]}`, {
            method: "DELETE",
            headers: headers({ "content-type": "application/json" }),
            body: JSON.stringify({ playbackId: playback.split(" ")[1] }),
          });
          assert.equal(released.status, 200);
        }
        const opened = await openSession(stack.base, id);
        assert.equal(opened.response.status, 201);
        assert.equal(opened.body.manifestUrl.startsWith("/v1/hls/"), true);
        assert.equal(JSON.stringify(opened.body).includes(stack.mock.url), false);
        playback = `${id} ${opened.body.playbackId}`;
      }
      assert.ok(Date.now() - started < 10_000);
      const body = await stats(stack.base);
      assert.equal(body.activeSessions, 1);
      assert.equal(body.sessions[0]?.aceId, ids[4]);
      const snap = stack.mock.snapshot();
      assert.deepEqual(snap.active, [ids[4]]);
      assert.equal(snap.stops.length, 4);
      assert.equal(snap.opens.every((item) => item.useApiStop), true);
    } finally {
      await stack.close();
    }
  });

  it("fan-out: dos espectadores comparten un arranque del motor", async () => {
    const stack = await startStack();
    try {
      const id = ace("a");
      const first = await openSession(stack.base, id);
      const second = await openSession(stack.base, id);
      assert.equal(first.body.sessionId, second.body.sessionId);
      assert.notEqual(first.body.playbackId, second.body.playbackId);
      const body = await stats(stack.base);
      assert.equal(body.activeSessions, 1);
      assert.equal(body.sessions[0]?.viewers, 2);
      assert.equal(stack.mock.snapshot().opens.length, 1);
      const released = await fetch(`${stack.base}/v1/sessions/${id}`, {
        method: "DELETE",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({ playbackId: first.body.playbackId }),
      });
      assert.equal(released.status, 200);
      assert.equal(stack.mock.snapshot().active.length, 1);
      await fetch(`${stack.base}/v1/sessions/${id}`, {
        method: "DELETE",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({ playbackId: second.body.playbackId }),
      });
      assert.equal(stack.mock.snapshot().stops.length, 1);
      assert.equal((await stats(stack.base)).activeSessions, 0);
    } finally {
      await stack.close();
    }
  });

  it("tres canales distintos conviven y el cuarto por encima del límite no", async () => {
    const stack = await startStack({ maxSessions: 3 });
    try {
      const ids = ["a", "b", "c"].map(ace);
      for (const id of ids) {
        const opened = await openSession(stack.base, id);
        assert.equal(opened.response.status, 201);
      }
      const body = await stats(stack.base);
      assert.equal(body.activeSessions, 3);
      assert.equal(stack.mock.snapshot().active.length, 3);
      const denied = await openSession(stack.base, ace("d"));
      assert.equal(denied.response.status, 503);
      assert.equal(stack.mock.snapshot().opens.length, 3);
    } finally {
      await stack.close();
    }
  });

  it("el ttl para la sesión inactiva y un segmento lo aplaza", async () => {
    const ttl = 1_000;
    const stack = await startStack({ ttlMs: ttl });
    try {
      const id = ace("a");
      const opened = await openSession(stack.base, id);
      await stack.clock.advance(ttl - 1);
      assert.equal((await stats(stack.base)).activeSessions, 1);
      const manifest = await fetch(`${stack.base}${opened.body.manifestUrl}`, { headers: headers() });
      assert.equal(manifest.status, 200);
      const text = await manifest.text();
      assert.equal(text.includes("#EXTM3U"), true);
      assert.equal(text.includes(stack.mock.url), false);
      assert.equal(text.includes("/v1/hls/"), true);
      await stack.clock.advance(ttl - 1);
      assert.equal((await stats(stack.base)).activeSessions, 1);
      await stack.clock.advance(2);
      assert.equal((await stats(stack.base)).activeSessions, 0);
      assert.equal(stack.mock.snapshot().stops.length, 1);
      assert.equal(stack.mock.snapshot().active.length, 0);
    } finally {
      await stack.close();
    }
  });

  it("el manifiesto que aún no es m3u responde 503 y luego el vídeo", async () => {
    const stack = await startStack();
    try {
      const opened = await openSession(stack.base, ace("1"));
      assert.equal(opened.response.status, 201);
      const first = await fetch(`${stack.base}${opened.body.manifestUrl}`, { headers: headers() });
      assert.equal(first.status, 503);
      assert.equal(first.headers.get("retry-after"), "1");
      await fetch(`${stack.base}${opened.body.manifestUrl}`, { headers: headers() });
      const third = await fetch(`${stack.base}${opened.body.manifestUrl}`, { headers: headers() });
      assert.equal(third.status, 200);
      const playlist = await third.text();
      const media = playlist.split("\n").find((line) => line.startsWith("/v1/hls/"));
      assert.ok(media);
      const segment = await fetch(`${stack.base}${media}`, { headers: headers() });
      assert.equal(segment.status, 200);
      const bytes = new Uint8Array(await segment.arrayBuffer());
      assert.equal(bytes[0], 0x47);
    } finally {
      await stack.close();
    }
  });
});
