import { randomUUID } from "node:crypto";
import { normalizeAceId } from "@bootlyga/domain";
import type { Clock } from "./clock.ts";
import type { Engine, PlaybackHandle } from "./engine.ts";
import { HttpError } from "./errors.ts";
import { log } from "./log.ts";

export type PublicSession = {
  sessionId: string;
  playbackId: string;
  manifestUrl: string;
};

export type SessionStats = {
  activeSessions: number;
  maxP2PSessions: number;
  maxViewersPerSession: number;
  sessions: {
    aceId: string;
    sessionId: string;
    viewers: number;
    expiresIn: number;
  }[];
};

type LiveSession = {
  aceId: string;
  sessionId: string;
  viewers: Set<string>;
  handle: PlaybackHandle;
  expiresAt: number;
  timer: { cancel(): void } | null;
  controller: AbortController;
};

export type SessionManager = {
  open(aceId: string): Promise<PublicSession>;
  release(aceId: string, playbackId: string): Promise<void>;
  forceStop(aceId: string): Promise<void>;
  get(sessionId: string): LiveSession | null;
  touch(sessionId: string): Promise<LiveSession | null>;
  stats(): SessionStats;
  dispose(): Promise<void>;
};

export function createSessions(opts: {
  engine: Engine;
  clock: Clock;
  maxSessions: number;
  maxViewers: number;
  ttlMs: number;
}): SessionManager {
  const byAce = new Map<string, LiveSession>();
  const bySession = new Map<string, LiveSession>();
  let tail: Promise<void> = Promise.resolve();

  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = tail.then(fn, fn);
    tail = run.then(() => undefined, () => undefined);
    return run;
  }

  function arm(session: LiveSession) {
    session.timer?.cancel();
    session.expiresAt = opts.clock.now() + opts.ttlMs;
    session.timer = opts.clock.schedule(() => expire(session.aceId), opts.ttlMs);
  }

  async function halt(session: LiveSession): Promise<void> {
    session.timer?.cancel();
    session.controller.abort();
    try {
      await opts.engine.stop(session.handle);
    } catch (error) {
      session.controller = new AbortController();
      arm(session);
      throw error;
    }
    byAce.delete(session.aceId);
    bySession.delete(session.sessionId);
    log("info", "sesión parada", { ace: session.aceId.slice(0, 6) });
  }

  async function expire(aceId: string): Promise<void> {
    await exclusive(async () => {
      const session = byAce.get(aceId);
      if (!session) return;
      if (opts.clock.now() < session.expiresAt) return;
      await halt(session);
      log("info", "ttl cumplido", { ace: aceId.slice(0, 6) });
    });
  }

  return {
    open(aceId) {
      const id = normalizeAceId(aceId);
      if (!id) throw new HttpError(400, "El identificador tiene que ser 40 caracteres hexadecimales.");
      return exclusive(async () => {
        const existing = byAce.get(id);
        if (existing) {
          if (existing.viewers.size >= opts.maxViewers) {
            throw new HttpError(429, "Demasiados espectadores en este canal.");
          }
          const playbackId = randomUUID();
          existing.viewers.add(playbackId);
          arm(existing);
          log("info", "fan-out", { ace: id.slice(0, 6), viewers: existing.viewers.size });
          return view(existing, playbackId);
        }
        if (byAce.size >= opts.maxSessions) throw new HttpError(503, "Demasiados canales a la vez.");
        const handle = await opts.engine.open(id);
        const playbackId = randomUUID();
        const session: LiveSession = {
          aceId: id,
          sessionId: randomUUID(),
          viewers: new Set([playbackId]),
          handle,
          expiresAt: 0,
          timer: null,
          controller: new AbortController(),
        };
        byAce.set(id, session);
        bySession.set(session.sessionId, session);
        arm(session);
        log("info", "sesión abierta", { ace: id.slice(0, 6), viewers: 1 });
        return view(session, playbackId);
      });
    },

    release(aceId, playbackId) {
      const id = normalizeAceId(aceId);
      if (!id) throw new HttpError(400, "Identificador no válido.");
      return exclusive(async () => {
        const session = byAce.get(id);
        if (!session || !session.viewers.has(playbackId)) {
          throw new HttpError(404, "No está ese espectador.");
        }
        session.viewers.delete(playbackId);
        if (session.viewers.size === 0) {
          try {
            await halt(session);
          } catch (error) {
            session.viewers.add(playbackId);
            throw error;
          }
          return;
        }
        arm(session);
      });
    },

    forceStop(aceId) {
      const id = normalizeAceId(aceId);
      if (!id) throw new HttpError(400, "Identificador no válido.");
      return exclusive(async () => {
        const session = byAce.get(id);
        if (!session) return;
        await halt(session);
      });
    },

    get(sessionId) {
      return bySession.get(sessionId) ?? null;
    },

    touch(sessionId) {
      return exclusive(async () => {
        const session = bySession.get(sessionId);
        if (!session) return null;
        arm(session);
        return session;
      });
    },

    stats() {
      return {
        activeSessions: byAce.size,
        maxP2PSessions: opts.maxSessions,
        maxViewersPerSession: opts.maxViewers,
        sessions: [...byAce.values()].map((session) => ({
          aceId: session.aceId,
          sessionId: session.sessionId,
          viewers: session.viewers.size,
          expiresIn: Math.max(0, Math.round((session.expiresAt - opts.clock.now()) / 1000)),
        })),
      };
    },

    dispose() {
      return exclusive(async () => {
        const active = [...byAce.values()];
        byAce.clear();
        bySession.clear();
        for (const session of active) {
          session.timer?.cancel();
          session.controller.abort();
        }
        await Promise.allSettled(
          active.map(async (session) => {
            try {
              await opts.engine.stop(session.handle);
              log("info", "sesión parada al cerrar", { ace: session.aceId.slice(0, 6) });
            } catch (error) {
              log("warn", "no se pudo parar sesión al cerrar", {
                ace: session.aceId.slice(0, 6),
                message: error instanceof Error ? error.message : "error",
              });
            }
          }),
        );
      });
    },
  };
}

function view(session: LiveSession, playbackId: string): PublicSession {
  return {
    sessionId: session.sessionId,
    playbackId,
    manifestUrl: `/v1/hls/${session.sessionId}/index.m3u8`,
  };
}
