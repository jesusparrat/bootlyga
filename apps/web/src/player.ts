import { ApiError, type Api, type SessionTelemetry } from "./api.ts";
import type HlsJs from "hls.js";

export type PlayerPhase = "idle" | "connecting" | "playing" | "error";

export type PlayerState = {
  phase: PlayerPhase;
  message: string;
  telemetry: SessionTelemetry | null;
};

export type Player = {
  play(aceId: string, title: string): Promise<void>;
  stop(): Promise<void>;
  destroy(): Promise<void>;
  currentAce(): string | null;
};

export function createPlayer(
  video: HTMLVideoElement,
  api: Api,
  token: string,
  onState: (state: PlayerState) => void,
): Player {
  let hls: HlsJs | null = null;
  let current: { aceId: string; playbackId: string; sessionId: string } | null = null;
  let generation = 0;
  let statTimer: number | null = null;
  let phase: PlayerPhase = "idle";
  let message = "";
  let telemetry: SessionTelemetry | null = null;

  function emit(next: Partial<PlayerState>) {
    if (next.phase !== undefined) phase = next.phase;
    if (next.message !== undefined) message = next.message;
    if (next.telemetry !== undefined) telemetry = next.telemetry;
    onState({ phase, message, telemetry });
  }

  function stopPolling() {
    if (statTimer !== null) {
      window.clearInterval(statTimer);
      statTimer = null;
    }
  }

  function startPolling(sessionId: string, mine: number) {
    stopPolling();
    const poll = () => {
      void api.sessionStat(sessionId).then((result) => {
        if (mine !== generation) return;
        emit({ telemetry: result.available ? result.stat : null });
      }).catch(() => {
        // Si la consulta puntual falla, mantenemos el último estado conocido.
      });
    };
    poll();
    statTimer = window.setInterval(poll, 2_000);
  }

  const onPageHide = () => {
    const leaving = current;
    current = null;
    stopPolling();
    if (!leaving) return;
    void fetch(`/v1/sessions/${leaving.aceId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ playbackId: leaving.playbackId }),
      keepalive: true,
    });
  };

  const onPlaying = () => {
    if (current && phase !== "playing") {
      emit({ phase: "playing", message: "Señal en marcha." });
    }
  };

  window.addEventListener("pagehide", onPageHide);
  video.addEventListener("playing", onPlaying);

  async function releaseCurrent(silent = false) {
    stopPolling();
    hls?.destroy();
    hls = null;
    video.pause();
    video.removeAttribute("src");
    video.load();
    const previous = current;
    current = null;
    if (!previous) return;
    try {
      await api.release(previous.aceId, previous.playbackId);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return;
      if (!silent) emit({ message: "No se ha podido avisar al motor para que pare." });
    }
  }

  return {
    currentAce: () => current?.aceId ?? null,

    async stop() {
      generation += 1;
      await releaseCurrent();
      emit({ phase: "idle", message: "", telemetry: null });
    },

    async destroy() {
      generation += 1;
      window.removeEventListener("pagehide", onPageHide);
      video.removeEventListener("playing", onPlaying);
      await releaseCurrent(true);
    },

    async play(aceId, title) {
      const mine = ++generation;
      await releaseCurrent(true);
      if (mine !== generation) return;
      emit({ phase: "connecting", message: "El motor está buscando pares.", telemetry: null });

      let session;
      try {
        session = await api.open(aceId);
      } catch (error) {
        if (mine !== generation) return;
        emit({
          phase: "error",
          message: error instanceof Error ? error.message : "No se ha abierto el canal.",
          telemetry: null,
        });
        return;
      }
      if (mine !== generation) {
        await api.release(aceId, session.playbackId).catch(() => undefined);
        return;
      }
      if (!session.manifestUrl.startsWith("/v1/hls/")) {
        await api.release(aceId, session.playbackId).catch(() => undefined);
        emit({
          phase: "error",
          message: "El gateway ha devuelto una ruta que no es suya.",
          telemetry: null,
        });
        return;
      }

      const { default: Hls } = await import("hls.js");
      if (mine !== generation) {
        await api.release(aceId, session.playbackId).catch(() => undefined);
        return;
      }
      if (!Hls.isSupported()) {
        await api.release(aceId, session.playbackId).catch(() => undefined);
        emit({
          phase: "error",
          message: "Este navegador no envía la clave con el vídeo. Hace falta uno con hls.js.",
          telemetry: null,
        });
        return;
      }

      current = { aceId, playbackId: session.playbackId, sessionId: session.sessionId };
      startPolling(session.sessionId, mine);

      const player = new Hls({
        enableWorker: true,
        manifestLoadingTimeOut: 20_000,
        manifestLoadingMaxRetry: 12,
        manifestLoadingRetryDelay: 1_000,
        manifestLoadingMaxRetryTimeout: 2_000,
        levelLoadingMaxRetry: 6,
        fragLoadingMaxRetry: 6,
        xhrSetup(xhr) {
          xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        },
        fetchSetup(context, initParams: RequestInit) {
          const headers = new Headers(initParams.headers ?? undefined);
          headers.set("Authorization", `Bearer ${token}`);
          return new Request(context.url, { ...initParams, headers });
        },
      });
      hls = player;

      player.on(Hls.Events.MANIFEST_PARSED, () => {
        if (mine !== generation) return;
        emit({ phase: "playing", message: "Señal en marcha." });
        video.play().catch(() => {
          if (mine !== generation) return;
          emit({ phase: "playing", message: "Pulsa el vídeo para empezar." });
        });
      });

      player.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || mine !== generation) return;
        const snapshot = telemetry;
        void releaseCurrent(true).then(() => {
          if (mine !== generation) return;
          emit({
            phase: "error",
            message: "El motor no ha entregado vídeo. Prueba otra fuente o vuelve a intentarlo.",
            telemetry: snapshot,
          });
        });
      });

      player.loadSource(session.manifestUrl);
      player.attachMedia(video);
      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title });
      }
    },
  };
}
