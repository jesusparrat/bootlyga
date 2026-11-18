import { isSafeEnginePath } from "./paths.ts";

export function rewritePlaylist(body: string, sessionId: string, playlistPath: string): string {
  const base = new URL(playlistPath, "http://engine.internal");
  return body
    .split(/\r?\n/)
    .map((line) => rewriteLine(line, sessionId, base))
    .join("\n");
}

function rewriteLine(line: string, sessionId: string, base: URL): string {
  if (line.startsWith("#")) {
    return line.replace(/URI="([^"]*)"/g, (_match, uri: string) => {
      const path = resolveEnginePath(uri, base);
      return path ? `URI="${mediaUrl(sessionId, path)}"` : `URI=""`;
    });
  }
  const trimmed = line.trim();
  if (!trimmed) return line;
  const path = resolveEnginePath(trimmed, base);
  return path ? mediaUrl(sessionId, path) : "# ruta externa omitida";
}

export function resolveEnginePath(ref: string, base: URL): string | null {
  let url: URL;
  try {
    url = new URL(ref, base);
  } catch {
    return null;
  }
  if (!isSafeEnginePath(url.pathname)) return null;
  return url.pathname + url.search;
}

function mediaUrl(sessionId: string, path: string): string {
  return `/v1/hls/${sessionId}/media?path=${encodeURIComponent(path)}`;
}
