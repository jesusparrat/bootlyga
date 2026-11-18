import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

export async function serveStatic(root: string, urlPath: string, res: ServerResponse): Promise<boolean> {
  let decoded = urlPath;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return false;
  }
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  if (!relative || relative.includes("\0")) return false;
  const rootResolved = path.resolve(root);
  const file = path.resolve(rootResolved, relative);
  if (file !== rootResolved && !file.startsWith(`${rootResolved}${path.sep}`)) return false;
  let info;
  try {
    info = await stat(file);
  } catch {
    return false;
  }
  if (!info.isFile()) return false;
  const ext = path.extname(file);
  const cache = file.endsWith(`${path.sep}index.html`) || file.endsWith(`${path.sep}sw.js`) ? "no-cache" : "public, max-age=86400";
  res.writeHead(200, {
    "content-type": TYPES[ext] ?? "application/octet-stream",
    "content-length": info.size,
    "cache-control": cache,
  });
  await pipeline(createReadStream(file), res);
  return true;
}
