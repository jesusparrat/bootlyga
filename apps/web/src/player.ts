import { ApiError, type Api, type SessionTelemetry } from "./api.ts";
import type HlsJs from "hls.js";

export type PlayerPhase = "idle" | "connecting" | "ready" | "playing" | "error";

export type PlayerState = {
  phase: PlayerPhase;
  message: string;
  telemetry: SessionTelemetry | null;
};

export type Player = {
  play(aceId: string, title: string): Promise<void>;
  resume(): Promise<void>;
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
  let preheatAbort: AbortController | null = null;
  let nativeMode = false;
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
    preheatAbort?.abort();
    preheatAbort = null;
    if (!leaving) return;
    void fetch(`/v1/sessions/${leaving.aceId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ playbackId: leaving.playbackId }),
      credentials: "same-origin",
      keepalive: true,
    });
  };

  const onPlaying = () => {
    if (current && phase !== "playing") {
      emit({ phase: "playing", message: "Señal en marcha." });
    }
  };

  const onVideoError = () => {
    if (!nativeMode || !current) return;
    const mine = generation;
    const snapshot = telemetry;
    void releaseCurrent(true).then(() => {
      if (mine !== generation) return;
      emit({
        phase: "error",
        message: "El reproductor no ha podido abrir el directo. Prueba otra fuente o vuelve a intentarlo.",
        telemetry: snapshot,
      });
    });
  };

  window.addEventListener("pagehide", onPageHide);
  video.addEventListener("playing", onPlaying);
  video.addEventListener("error", onVideoError);

  async function releaseCurrent(silent = false) {
    stopPolling();
    preheatAbort?.abort();
    preheatAbort = null;
    nativeMode = false;
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

  async function waitForPlayableManifest(manifestUrl: string, signal: AbortSignal): Promise<boolean> {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      if (signal.aborted) return false;
      try {
        const response = await fetch(manifestUrl, {
          headers: { authorization: `Bearer ${token}` },
          credentials: "same-origin",
          signal,
        });
        if (response.status === 200) {
          const text = await response.text();
          if (hasPlayableSegment(text)) return true;
        } else if (response.status !== 503 && response.status !== 504) {
          return false;
        }
      } catch {
        if (signal.aborted) return false;
      }
      await sleep(1_000, signal);
    }
    return false;
  }

  return {
    currentAce: () => current?.aceId ?? null,

    async resume() {
      if (!current) return;
      try {
        await video.play();
        emit({ phase: "playing", message: "Señal en marcha." });
      } catch {
        emit({ phase: "ready", message: "Pulsa el vídeo para empezar." });
      }
    },

    async stop() {
      generation += 1;
      await releaseCurrent();
      emit({ phase: "idle", message: "", telemetry: null });
    },

    async destroy() {
      generation += 1;
      window.removeEventListener("pagehide", onPageHide);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("error", onVideoError);
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

      const nativeSupported = supportsNativeHls(video);
      const preferNative = nativeSupported && !hasStandardMse();

      if (!preferNative) {
        const { default: Hls } = await import("hls.js");
        if (mine !== generation) {
          await api.release(aceId, session.playbackId).catch(() => undefined);
          return;
        }
        if (Hls.isSupported()) {
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
              return new Request(context.url, { ...initParams, headers, credentials: "same-origin" });
            },
          });
          hls = player;

          player.on(Hls.Events.MANIFEST_PARSED, () => {
            if (mine !== generation) return;
            video.play().then(() => {
              if (mine !== generation) return;
              emit({ phase: "playing", message: "Señal en marcha." });
            }).catch(() => {
              if (mine !== generation) return;
              emit({ phase: "ready", message: "Señal lista. Pulsa para reproducir." });
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
          setMediaMetadata(title);
          return;
        }
      }

      if (!nativeSupported) {
        await api.release(aceId, session.playbackId).catch(() => undefined);
        emit({
          phase: "error",
          message: "Este navegador no soporta vídeo HLS.",
          telemetry: null,
        });
        return;
      }

      // Modo HLS nativo (iPhone / Safari): precalentamos hasta tener al menos un segmento real
      // antes de entregar la URL a AVFoundation, que usa la cookie HttpOnly bootlyga_hls.
      current = { aceId, playbackId: session.playbackId, sessionId: session.sessionId };
      startPolling(session.sessionId, mine);
      const abort = new AbortController();
      preheatAbort = abort;

      const ready = await waitForPlayableManifest(session.manifestUrl, abort.signal);
      if (mine !== generation) return;
      preheatAbort = null;

      if (!ready) {
        const snapshot = telemetry;
        await releaseCurrent(true);
        if (mine !== generation) return;
        emit({
          phase: "error",
          message: "El motor no ha entregado vídeo a tiempo. Prueba otra fuente o vuelve a intentarlo.",
          telemetry: snapshot,
        });
        return;
      }

      nativeMode = true;
      video.src = session.manifestUrl;
      setMediaMetadata(title);
      try {
        await video.play();
        if (mine !== generation) return;
        emit({ phase: "playing", message: "Señal en marcha." });
      } catch {
        if (mine !== generation) return;
        emit({ phase: "ready", message: "Señal lista. Pulsa para reproducir." });
      }
    },
  };
}

function supportsNativeHls(video: HTMLVideoElement): boolean {
  return video.canPlayType("application/vnd.apple.mpegurl") !== "";
}

function hasStandardMse(): boolean {
  return typeof window !== "undefined" && typeof window.MediaSource !== "undefined";
}

function hasPlayableSegment(playlist: string): boolean {
  if (!playlist.includes("#EXTM3U")) return false;
  return playlist
    .split(/\r?\n/)
    .some((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith("#");
    });
}

function setMediaMetadata(title: string) {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title });
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
