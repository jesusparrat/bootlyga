const base = process.env.GATEWAY_URL ?? "http://127.0.0.1:8080";
const token = process.env.BOOTLYGA_TOKEN;
if (!token) throw new Error("Falta BOOTLYGA_TOKEN");

const aceId = "0123456789abcdef0123456789abcdef01234567";

async function waitReady() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${base}/health/ready`);
      if (response.ok) return;
    } catch {
      // el gateway todavía arranca
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("el gateway no está listo");
}

await waitReady();

const page = await fetch(base);
if (!page.ok) throw new Error(`la pwa no responde: ${page.status}`);
const html = await page.text();
if (!html.includes("Bootlyga")) throw new Error("la pwa no es la esperada");

const query = await fetch(`${base}/v1/stats?token=${encodeURIComponent(token)}`, {
  headers: { authorization: `Bearer ${token}` },
});
if (query.status !== 400) throw new Error(`la query con clave debía ser 400 y fue ${query.status}`);

const opened = await fetch(`${base}/v1/sessions`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ aceId }),
});
if (!opened.ok) throw new Error(await opened.text());
const setCookie = opened.headers.get("set-cookie") ?? "";
if (!setCookie.includes("bootlyga_hls=") || !setCookie.includes("HttpOnly")) {
  throw new Error("falta cookie HttpOnly de reproducción HLS");
}
const hlsCookie = setCookie.split(";")[0];
const session = await opened.json();
if (!String(session.manifestUrl).startsWith("/v1/hls/")) throw new Error("manifiesto fuera del gateway");
if (JSON.stringify(session).includes("6878")) throw new Error("url de motor filtrada");

const manifest = await fetch(base + session.manifestUrl, { headers: { cookie: hlsCookie } });
const playlist = await manifest.text();
if (manifest.status !== 200 || !playlist.includes("#EXTM3U")) throw new Error(playlist);
if (playlist.includes("6878")) throw new Error("playlist sin reescribir");
const media = playlist.split("\n").find((line) => line.startsWith("/v1/hls/"));
if (!media) throw new Error("sin segmento");
const segment = await fetch(base + media, { headers: { cookie: hlsCookie, range: "bytes=0-187" } });
if (segment.status !== 206) throw new Error(`se esperaba 206 para Range y fue ${segment.status}`);
const bytes = new Uint8Array(await segment.arrayBuffer());
if (bytes[0] !== 0x47) throw new Error("el segmento no es MPEG-TS");

const cookieOnlyStats = await fetch(`${base}/v1/stats`, { headers: { cookie: hlsCookie } });
if (cookieOnlyStats.status !== 401) throw new Error("la cookie HLS no debe abrir /v1/stats");

const released = await fetch(`${base}/v1/sessions/${aceId}`, {
  method: "DELETE",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ playbackId: session.playbackId }),
});
if (!released.ok) throw new Error(await released.text());
const after = await fetch(`${base}/v1/stats`, { headers: { authorization: `Bearer ${token}` } });
const body = await after.json();
if (body.activeSessions !== 0) throw new Error("la sesión sigue activa");

console.log("smoke ok");
