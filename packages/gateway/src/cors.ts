import type { IncomingMessage, ServerResponse } from "node:http";

/** Devuelve true si la petición ya quedó respondida. Nunca escribe `*`. */
export function applyCors(req: IncomingMessage, res: ServerResponse, origins: string[]): boolean {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  const allowed = origin !== "" && origins.includes(origin);
  if (allowed) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
    res.setHeader("access-control-allow-headers", "Authorization, Content-Type");
    res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("access-control-max-age", "600");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(allowed || origin === "" ? 204 : 403);
    res.end();
    return true;
  }
  return false;
}
