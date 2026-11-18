import type { Api } from "./api.ts";
import type HlsJs from "hls.js";

export type Player = {
  play(aceId: string, title: string): Promise<void>;
  stop(): Promise<void>;
  currentAce(): string | null;
};

export function createPlayer(video: HTMLVideoElement, api: Api, token: string, onStatus: (text: string) => void): Player {
  let hls: HlsJs | null = null;
  let current: { aceId: string; playbackId: string } | null = null;
  let generation = 0;

  window.addEventListener("pagehide", () => {
    const leaving = current;
    current = null;
    if (!leaving) return;
    void fetch(`/v1/sessions/${leaving.aceId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ playbackId: leaving.playbackId }),
      keepalive: true,
    });
  });

  async function releaseCurrent() {
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
    } catch {
      onStatus("No se ha podido avisar al motor para que pare.");
    }
  }

  return {
    currentAce: () => current?.aceId ?? null,
    async stop() {
      generation += 1;
      await releaseCurrent();
      onStatus("");
    },
    async play(aceId, title) {
      const mine = ++generation;
      await releaseCurrent();
      if (mine !== generation) return;
      onStatus("El motor está buscando pares.");
      let session;
      try {
        session = await api.open(aceId);
      } catch (error) {
        if (mine !== generation) return;
        onStatus(error instanceof Error ? error.message : "No se ha abierto el canal.");
        return;
      }
      if (mine !== generation) {
        await api.release(aceId, session.playbackId).catch(() => undefined);
        return;
      }
      if (!session.manifestUrl.startsWith("/v1/hls/")) {
        await api.release(aceId, session.playbackId).catch(() => undefined);
        onStatus("El gateway ha devuelto una ruta que no es suya.");
        return;
      }
      const { default: Hls } = await import("hls.js");
      if (mine !== generation) {
        await api.release(aceId, session.playbackId).catch(() => undefined);
        return;
      }
      if (!Hls.isSupported()) {
        await api.release(aceId, session.playbackId).catch(() => undefined);
        onStatus("Este navegador no envía la clave con el vídeo. Hace falta uno con hls.js.");
        return;
      }
      current = { aceId, playbackId: session.playbackId };
      const player = new Hls({
        enableWorker: true,
        manifestLoadingMaxRetry: 8,
        manifestLoadingRetryDelay: 400,
        levelLoadingMaxRetry: 6,
        fragLoadingMaxRetry: 4,
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
        onStatus("Señal en marcha.");
        video.play().catch(() => onStatus("Pulsa el vídeo para empezar."));
      });
      player.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || mine !== generation) return;
        onStatus("El motor no ha entregado vídeo. Puedes volver a elegir el canal.");
      });
      player.loadSource(session.manifestUrl);
      player.attachMedia(video);
      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title });
      }
    },
  };
}
