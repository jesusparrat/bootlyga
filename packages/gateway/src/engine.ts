import { HttpError } from "./errors.ts";
import { isSafeEnginePath } from "./paths.ts";

export type PlaybackHandle = {
  aceId: string;
  infohash: string;
  playbackPath: string;
  commandPath: string;
  statPath: string | null;
};

export type EngineResponse = {
  status: number;
  contentType: string | null;
  text: () => Promise<string>;
  stream: ReadableStream<Uint8Array> | null;
};

export type Engine = {
  open(aceId: string): Promise<PlaybackHandle>;
  stop(handle: PlaybackHandle): Promise<void>;
  fetch(path: string, opts: { signal?: AbortSignal; range?: string | null }): Promise<EngineResponse>;
  probe(): Promise<{ ok: boolean; version: string | null }>;
};

const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

export type EngineOptions = {
  fetchTimeoutMs?: number;
};

/**
 * Cliente del HTTP API del motor.
 * Arranque con format=json y use_api_stop=1. Parada con command_url?method=stop.
 * Documentado en https://docs.acestream.media/developers/start-playback/
 * El navegador no recibe nunca estas URLs.
 */
export function createEngine(aceBase: string, engineOpts: EngineOptions = {}): Engine {
  const origin = new URL(aceBase).origin;
  const fetchTimeoutMs = engineOpts.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;

  function localUrl(path: string): URL {
    if (!isSafeEnginePath(path.split("?")[0] ?? path)) {
      throw new HttpError(400, "Ruta del motor no permitida.");
    }
    const url = new URL(path, aceBase);
    if (url.origin !== origin || !isSafeEnginePath(url.pathname)) {
      throw new HttpError(400, "Ruta del motor no permitida.");
    }
    return url;
  }

  return {
    async open(aceId) {
      const url = new URL("/ace/manifest.m3u8", aceBase);
      url.searchParams.set("id", aceId);
      url.searchParams.set("format", "json");
      url.searchParams.set("use_api_stop", "1");
      let response: Response;
      try {
        response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      } catch {
        throw new HttpError(503, "El motor no responde.");
      }
      if (!response.ok) throw new HttpError(503, "El motor aún no tiene el manifiesto.");
      const payload = (await response.json()) as { error?: unknown; response?: Record<string, unknown> };
      if (payload.error) throw new HttpError(503, "El motor ha rechazado el canal.");
      const body = payload.response;
      if (!body) throw new HttpError(502, "Respuesta del motor sin datos.");
      const playback = asString(body.playback_url);
      const command = asString(body.command_url);
      if (!playback || !command) throw new HttpError(502, "El motor no ha dado una sesión controlable.");
      return {
        aceId,
        infohash: asString(body.infohash) ?? aceId,
        playbackPath: toEnginePath(playback),
        commandPath: toEnginePath(command),
        statPath: asString(body.stat_url) ? toEnginePath(String(body.stat_url)) : null,
      };
    },

    async stop(handle) {
      const url = localUrl(handle.commandPath);
      url.searchParams.set("method", "stop");
      let response: Response;
      try {
        response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      } catch {
        throw new HttpError(502, "No se ha podido parar el canal en el motor.");
      }
      if (!response.ok && response.status !== 404) {
        throw new HttpError(502, "El motor no ha parado el canal.");
      }
    },

    async fetch(path, opts) {
      let current = localUrl(path);
      const timeout = AbortSignal.timeout(fetchTimeoutMs);
      const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
      for (let hop = 0; hop < 3; hop += 1) {
        const headers: Record<string, string> = {};
        if (opts.range) headers.range = opts.range;
        let response: Response;
        try {
          response = await fetch(current, { redirect: "manual", signal, headers });
        } catch (error) {
          if (opts.signal?.aborted) throw new HttpError(499, "Petición cancelada.");
          if (timeout.aborted) throw new HttpError(504, "El motor ha tardado demasiado en responder.");
          throw error;
        }
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location) throw new HttpError(502, "Redirección del motor vacía.");
          const next = new URL(location, current);
          if (next.origin !== origin || !isSafeEnginePath(next.pathname)) {
            throw new HttpError(502, "Redirección del motor fuera de sitio.");
          }
          current = next;
          continue;
        }
        return {
          status: response.status,
          contentType: response.headers.get("content-type"),
          text: async () => {
            try {
              return await response.text();
            } catch (error) {
              if (opts.signal?.aborted) throw new HttpError(499, "Petición cancelada.");
              if (timeout.aborted) throw new HttpError(504, "El motor ha tardado demasiado en responder.");
              throw error;
            }
          },
          stream: response.body,
        };
      }
      throw new HttpError(502, "Demasiadas redirecciones del motor.");
    },

    async probe() {
      try {
        const url = new URL("/webui/api/service", aceBase);
        url.searchParams.set("method", "get_version");
        const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
        if (!response.ok) return { ok: false, version: null };
        const payload = (await response.json()) as { result?: { version?: unknown } };
        const version = payload.result?.version;
        return { ok: true, version: version == null ? "desconocida" : String(version) };
      } catch {
        return { ok: false, version: null };
      }
    },
  };
}

function toEnginePath(value: string): string {
  const url = value.startsWith("/") ? new URL(value, "http://engine.internal") : new URL(value);
  if (!isSafeEnginePath(url.pathname)) throw new HttpError(502, "El motor ha devuelto una ruta no permitida.");
  return url.pathname + url.search;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
