import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { startMock } from "../src/server.ts";

describe("mock", () => {
  it("sirve un MPEG-TS de barras, no un canal", async () => {
    const mock = await startMock();
    try {
      const id = "abcdeabcdeabcdeabcdeabcdeabcdeabcdeabcde";
      const opened = await fetch(`${mock.url}/ace/manifest.m3u8?id=${id}&format=json&use_api_stop=1`);
      const payload = await opened.json() as { response: { playback_url: string; command_url: string } };
      const playlist = await (await fetch(payload.response.playback_url)).text();
      assert.match(playlist, /#EXTM3U/);
      const segmentUrl = playlist.split("\n").find((line) => line.startsWith("http"));
      assert.ok(segmentUrl);
      const bytes = new Uint8Array(await (await fetch(segmentUrl)).arrayBuffer());
      assert.equal(bytes[0], 0x47);
      const stop = await fetch(`${payload.response.command_url}?method=stop`);
      assert.equal(stop.status, 200);
      assert.deepEqual(mock.snapshot().active, []);
      assert.equal(mock.snapshot().opens[0]?.useApiStop, true);
    } finally {
      await mock.close();
    }
  });
});