import type { Catalog } from "@bootlyga/domain";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export type SessionResponse = {
  sessionId: string;
  playbackId: string;
  manifestUrl: string;
};

export type SessionTelemetry = {
  status: string | null;
  peers: number | null;
  progress: number | null;
  speedDown: number | null;
};

export type SessionStatResponse = {
  available: boolean;
  stat: SessionTelemetry | null;
};

type ChannelResponse = {
  catalog: Catalog;
};

type ImportResponse = ChannelResponse & {
  addedChannels: number;
  addedSources: number;
  skipped: number;
};

export function createApi(token: string) {
  async function send<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${token}`);
    if (init?.body) headers.set("content-type", "application/json");
    const response = await fetch(path, { ...init, headers });
    const text = await response.text();
    const data = text ? JSON.parse(text) as { error?: string } : {};
    if (!response.ok) throw new ApiError(data.error ?? "La petición ha fallado.", response.status);
    return data as T;
  }

  return {
    catalog: () => send<Catalog>("/v1/catalog"),
    addChannel: (input: { name: string; group: string; acestreamId: string; quality: string }) =>
      send<ChannelResponse>("/v1/channels", { method: "POST", body: JSON.stringify(input) }),
    removeChannel: (id: string) => send<Catalog>(`/v1/channels/${id}`, { method: "DELETE" }),
    importM3u: (text: string) =>
      send<ImportResponse>("/v1/import/m3u", { method: "POST", body: JSON.stringify({ text }) }),
    open: (aceId: string) =>
      send<SessionResponse>("/v1/sessions", { method: "POST", body: JSON.stringify({ aceId }) }),
    sessionStat: (sessionId: string) =>
      send<SessionStatResponse>(`/v1/sessions/${sessionId}/stat`),
    release: (aceId: string, playbackId: string) =>
      send<{ ok: boolean }>(`/v1/sessions/${aceId}`, {
        method: "DELETE",
        body: JSON.stringify({ playbackId }),
        keepalive: true,
      }),
  };
}

export type Api = ReturnType<typeof createApi>;
