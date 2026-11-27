import "@fontsource-variable/archivo/wdth.css";
import "@fontsource-variable/doto";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./styles.css";
import {
  formatMadridClock,
  groupCounts,
  matchesQuery,
  moveFocus,
  type Catalog,
  type Channel,
  type Slot,
  type Source,
} from "@bootlyga/domain";
import { ApiError, createApi, type Api, type SessionTelemetry } from "./api.ts";
import { createPlayer, type Player, type PlayerState } from "./player.ts";

const TOKEN_KEY = "bootlyga.token";
const THEME_KEY = "bootlyga.theme";

const engine = must<HTMLElement>("#engine");
const settingsOpen = must<HTMLButtonElement>("#settings-open");
const themeButton = must<HTMLButtonElement>("#theme");
const boot = must<HTMLElement>("#boot");
const gatePanel = must<HTMLElement>("#gate-panel");
const gate = must<HTMLFormElement>("#gate");
const gateError = must<HTMLElement>("#gate-error");
const app = must<HTMLElement>("#app");

const stageKicker = must<HTMLElement>("#stage-kicker");
const stageTitle = must<HTMLElement>("#stage-title");
const stageFrame = must<HTMLElement>("#stage-frame");
const stageOverlay = must<HTMLElement>("#stage-overlay");
const overlayKicker = must<HTMLElement>("#overlay-kicker");
const overlayTitle = must<HTMLElement>("#overlay-title");
const overlayDetail = must<HTMLElement>("#overlay-detail");
const overlayPlay = must<HTMLButtonElement>("#overlay-play");
const overlaySettings = must<HTMLButtonElement>("#overlay-settings");
const overlayRetry = must<HTMLButtonElement>("#overlay-retry");
const overlayNextSource = must<HTMLButtonElement>("#overlay-next-source");
const stageStatus = must<HTMLElement>("#stage-status");
const clock = must<HTMLElement>("#clock");
const video = must<HTMLVideoElement>("#video");
const fullscreenButton = must<HTMLButtonElement>("#fullscreen");
const stopButton = must<HTMLButtonElement>("#stop");
const sourcesWrap = must<HTMLElement>("#sources-wrap");
const sourcesContainer = must<HTMLElement>("#sources");

const channelCount = must<HTMLElement>("#channel-count");
const search = must<HTMLInputElement>("#search");
const groups = must<HTMLElement>("#groups");
const empty = must<HTMLElement>("#empty");
const catalogError = must<HTMLElement>("#catalog-error");
const channels = must<HTMLElement>("#channels");

const settingsDialog = must<HTMLDialogElement>("#settings-dialog");
const settingsClose = must<HTMLButtonElement>("#settings-close");
const addForm = must<HTMLFormElement>("#add");
const addError = must<HTMLElement>("#add-error");
const importFile = must<HTMLInputElement>("#import-file");
const importForm = must<HTMLFormElement>("#import-form");
const importTextarea = must<HTMLTextAreaElement>("#import-form textarea[name='text']");
const importResult = must<HTMLElement>("#import-result");
const logoutButton = must<HTMLButtonElement>("#logout");
const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

let catalog: Catalog = { version: 1, channels: [], sources: [], events: [] };
let query = "";
let group = "Todos";
let activeChannelId: string | null = null;
let activeSourceId: string | null = null;
let pendingRemove: string | null = null;
let api: Api | null = null;
let player: Player | null = null;
let playerState: PlayerState = { phase: "idle", message: "", telemetry: null };

applyStoredTheme();
tickClock();
setInterval(tickClock, 30_000);
void refreshEngine();
setInterval(() => void refreshEngine(), 10_000);
syncFullscreenButton();

themeButton.addEventListener("click", () => {
  const next = resolvedTheme() === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  document.documentElement.dataset.theme = next;
  syncThemeButton();
});

settingsOpen.addEventListener("click", openSettings);
overlaySettings.addEventListener("click", openSettings);
settingsClose.addEventListener("click", closeSettings);
settingsDialog.addEventListener("click", (event) => {
  if (event.target === settingsDialog) closeSettings();
});

logoutButton.addEventListener("click", () => {
  closeSettings();
  sessionStorage.removeItem(TOKEN_KEY);
  const currentApi = api;
  void (currentApi ? currentApi.clearHlsAuth().catch(() => undefined) : Promise.resolve())
    .then(() => player?.destroy())
    .then(() => {
      player = null;
      api = null;
      activeChannelId = null;
      activeSourceId = null;
      playerState = { phase: "idle", message: "", telemetry: null };
      showGate();
    });
});

gate.addEventListener("submit", (event) => {
  event.preventDefault();
  const token = String(new FormData(gate).get("token") ?? "");
  sessionStorage.setItem(TOKEN_KEY, token);
  void enter(token);
});

search.addEventListener("input", () => {
  query = search.value;
  renderList();
});

addForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!api) return;
  const data = new FormData(addForm);
  addError.textContent = "";
  void api.addChannel({
    name: String(data.get("name") ?? ""),
    group: String(data.get("group") ?? ""),
    acestreamId: String(data.get("ace") ?? ""),
    quality: String(data.get("quality") ?? ""),
  }).then((result) => {
    catalog = result.catalog;
    addForm.reset();
    addError.textContent = "Canal añadido.";
    renderList();
    renderStage();
  }).catch((error: unknown) => {
    addError.textContent = error instanceof Error ? error.message : "No se ha podido añadir.";
  });
});

importFile.addEventListener("change", () => {
  const file = importFile.files?.[0];
  if (!file) return;
  void file.text().then((text) => {
    importTextarea.value = text;
    importResult.textContent = `Archivo ${file.name} cargado. Pulsa Incorporar lista.`;
  }).catch(() => {
    importResult.textContent = "No se ha podido leer el archivo.";
  });
});

importForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!api) return;
  const text = String(new FormData(importForm).get("text") ?? "");
  importResult.textContent = "";
  void api.importM3u(text).then((result) => {
    catalog = result.catalog;
    importForm.reset();
    importFile.value = "";
    importResult.textContent = `${result.addedChannels} canales, ${result.addedSources} fuentes. ${result.skipped} líneas se han dejado fuera.`;
    renderList();
    renderStage();
  }).catch((error: unknown) => {
    importResult.textContent = error instanceof Error ? error.message : "La lista no se ha incorporado.";
  });
});

stopButton.addEventListener("click", () => {
  void stopPlayback();
});

fullscreenButton.addEventListener("click", () => {
  void toggleFullscreen();
});

document.addEventListener("fullscreenchange", syncFullscreenButton);

overlayPlay.addEventListener("click", () => {
  void player?.resume();
});

overlayRetry.addEventListener("click", () => {
  const pair = activeSelection();
  if (pair) void playSource(pair.channel, pair.source);
});

overlayNextSource.addEventListener("click", () => {
  const next = nextSourceForActive();
  if (next) void playSource(next.channel, next.source);
});

document.addEventListener("keydown", (event) => {
  if (settingsDialog.open) return;

  if (event.key === "Escape") {
    if (pendingRemove) {
      pendingRemove = null;
      renderList();
    }
    if (event.target instanceof HTMLElement && event.target.matches("input, textarea, select")) {
      event.target.blur();
    }
    return;
  }

  const target = event.target;
  if (target instanceof HTMLElement && target.matches("input, textarea, select")) return;

  if ((event.key === "f" || event.key === "F") && !app.hidden) {
    event.preventDefault();
    void toggleFullscreen();
    return;
  }

  if (app.hidden) return;
  const channelButtons = [...channels.querySelectorAll<HTMLButtonElement>(".channel-play")];
  const groupButtons = [...groups.querySelectorAll<HTMLButtonElement>("button")];
  const slot = slotFrom(target instanceof HTMLElement ? target : document.body, channelButtons, groupButtons);
  const next = moveFocus(slot, event.key, { groups: groupButtons.length, channels: channelButtons.length });
  if (!isNavKey(event.key) || sameSlot(slot, next)) return;
  event.preventDefault();
  focusSlot(next, channelButtons, groupButtons);
});

const stored = sessionStorage.getItem(TOKEN_KEY);
if (stored) void enter(stored);
else showGate();

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js");
}

async function enter(token: string) {
  boot.hidden = false;
  gatePanel.hidden = true;
  app.hidden = true;
  settingsOpen.hidden = true;
  gateError.textContent = "";

  await player?.destroy();
  api = createApi(token);
  player = createPlayer(video, api, token, (state) => {
    playerState = state;
    renderStage();
  });

  try {
    catalog = await api.catalog();
  } catch (error) {
    sessionStorage.removeItem(TOKEN_KEY);
    showGate();
    gateError.textContent = error instanceof ApiError && error.status === 401
      ? "La clave no vale."
      : "No se ha podido abrir el catálogo.";
    return;
  }

  boot.hidden = true;
  app.hidden = false;
  settingsOpen.hidden = false;
  renderList();
  renderStage();
}

function showGate() {
  boot.hidden = true;
  gatePanel.hidden = false;
  app.hidden = true;
  settingsOpen.hidden = true;
}

function openSettings() {
  addError.textContent = "";
  importResult.textContent = "";
  if (!settingsDialog.open) settingsDialog.showModal();
}

function closeSettings() {
  if (settingsDialog.open) settingsDialog.close();
}

async function stopPlayback() {
  await player?.stop();
  activeChannelId = null;
  activeSourceId = null;
  playerState = { phase: "idle", message: "", telemetry: null };
  renderList();
  renderStage();
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    if (stageFrame.requestFullscreen) {
      await stageFrame.requestFullscreen();
      return;
    }
    const webkitVideo = video as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
    webkitVideo.webkitEnterFullscreen?.();
  } catch {
    // Algunos entornos restringen pantalla completa sin gesto directo.
  }
}

function syncFullscreenButton() {
  const active = Boolean(document.fullscreenElement);
  fullscreenButton.textContent = active ? "Salir de pantalla completa" : "Pantalla completa";
  fullscreenButton.setAttribute("aria-pressed", active ? "true" : "false");
}

function renderList() {
  const visible = visibleChannels();
  const names = groupCounts(catalog.channels);
  channelCount.textContent = `${visible.length} de ${catalog.channels.length}`;

  groups.replaceChildren();
  const all = chip("Todos", catalog.channels.length, group === "Todos");
  all.addEventListener("click", () => {
    group = "Todos";
    renderList();
  });
  groups.append(all);
  for (const item of names) {
    const button = chip(item.name, item.count, group === item.name);
    button.addEventListener("click", () => {
      group = item.name;
      renderList();
    });
    groups.append(button);
  }

  channels.replaceChildren();
  const nothing = catalog.channels.length === 0;
  empty.hidden = visible.length > 0;
  empty.textContent = nothing
    ? "No hay canales en este aparato. Ábrelos desde Ajustes."
    : "Ningún canal coincide con la búsqueda.";
  catalogError.hidden = true;

  for (const item of visible) {
    const row = document.createElement("li");
    row.className = item.channel.id === activeChannelId ? "channel is-on" : "channel";

    const play = document.createElement("button");
    play.type = "button";
    play.className = "channel-play";
    const name = document.createElement("span");
    name.className = "channel-name";
    name.textContent = item.channel.name;
    const meta = document.createElement("span");
    meta.className = "channel-meta";
    const sourceLabel = item.sources.length > 1 ? `${item.sources.length} fuentes` : null;
    meta.textContent = [item.primary.quality, item.channel.group, sourceLabel].filter(Boolean).join(" · ");
    play.append(name, meta);
    play.addEventListener("click", () => {
      void playSource(item.channel, item.primary);
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "channel-remove";
    remove.textContent = pendingRemove === item.channel.id ? "Confirmar" : "Quitar";
    remove.addEventListener("click", () => {
      void removeChannel(item.channel.id);
    });

    row.append(play, remove);
    channels.append(row);
  }
}

function renderStage() {
  const selection = activeSelection();
  const hasChannels = catalog.channels.length > 0;
  const telemetryLine = formatTelemetry(playerState.telemetry);
  const phase = selection ? playerState.phase : "idle";

  stopButton.disabled = !selection || phase === "idle";
  stageOverlay.dataset.phase = phase;
  stageOverlay.hidden = phase === "playing";

  if (!selection) {
    stageKicker.textContent = hasChannels ? "En espera" : "Sin canales";
    stageTitle.textContent = hasChannels ? "Elige un canal" : "Añade tus canales";
    stageStatus.textContent = "";

    overlayKicker.textContent = hasChannels ? "En espera" : "Catálogo vacío";
    overlayTitle.textContent = hasChannels ? "Elige un canal" : "No hay canales todavía";
    overlayDetail.textContent = hasChannels
      ? "Selecciona un canal de la lista para abrir el directo."
      : "Abre Ajustes para añadir un identificador o importar tu lista m3u.";
    overlayPlay.hidden = true;
    overlaySettings.hidden = hasChannels;
    overlayRetry.hidden = true;
    overlayNextSource.hidden = true;
    renderSources(null);
    return;
  }

  const { channel, source, sources } = selection;
  const sourceIndex = sources.findIndex((item) => item.id === source.id);
  const sourceTag = sources.length > 1 ? `Fuente ${sourceIndex + 1} de ${sources.length}` : "Fuente única";

  stageTitle.textContent = channel.name;
  overlaySettings.hidden = true;
  overlayPlay.hidden = true;

  if (phase === "connecting") {
    stageKicker.textContent = "Buscando pares";
    const statusText = telemetryLine ? `${sourceTag} · ${telemetryLine}` : `${sourceTag} · ${playerState.message}`;
    stageStatus.textContent = statusText;
    overlayKicker.textContent = "Buscando pares";
    overlayTitle.textContent = channel.name;
    overlayDetail.textContent = telemetryLine || playerState.message || "El motor está buscando pares.";
    overlayRetry.hidden = true;
    overlayNextSource.hidden = sources.length <= 1;
  } else if (phase === "ready") {
    stageKicker.textContent = "Señal lista";
    stageStatus.textContent = telemetryLine
      ? `${sourceTag} · ${telemetryLine}`
      : `${sourceTag} · ${playerState.message || "Pulsa para reproducir."}`;
    overlayKicker.textContent = "Señal lista";
    overlayTitle.textContent = channel.name;
    overlayDetail.textContent = playerState.message || "Pulsa para empezar la reproducción.";
    overlayPlay.hidden = false;
    overlayRetry.hidden = true;
    overlayNextSource.hidden = sources.length <= 1;
  } else if (phase === "playing") {
    stageKicker.textContent = "En directo";
    stageStatus.textContent = telemetryLine
      ? `${sourceTag} · ${telemetryLine}`
      : `${sourceTag} · ${playerState.message || "Señal en marcha."}`;
    overlayRetry.hidden = true;
    overlayNextSource.hidden = true;
  } else if (phase === "error") {
    stageKicker.textContent = "Error";
    stageStatus.textContent = telemetryLine ? `${playerState.message} (${telemetryLine})` : playerState.message;
    overlayKicker.textContent = "Sin señal";
    overlayTitle.textContent = channel.name;
    overlayDetail.textContent = playerState.message || "El motor no ha entregado vídeo.";
    overlayRetry.hidden = false;
    overlayNextSource.hidden = sources.length <= 1;
  } else {
    stageKicker.textContent = "En espera";
    stageStatus.textContent = "";
    overlayKicker.textContent = "En espera";
    overlayTitle.textContent = channel.name;
    overlayDetail.textContent = "Pulsa el canal para empezar.";
    overlayRetry.hidden = false;
    overlayNextSource.hidden = true;
  }

  renderSources(selection);
}

function renderSources(selection: { channel: Channel; source: Source; sources: Source[] } | null) {
  sourcesContainer.replaceChildren();
  if (!selection || selection.sources.length === 0) {
    sourcesWrap.hidden = true;
    return;
  }
  sourcesWrap.hidden = false;
  selection.sources.forEach((source, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "source-chip";
    const selected = source.id === selection.source.id;
    button.setAttribute("aria-pressed", selected ? "true" : "false");
    const label = [
      `Fuente ${index + 1}`,
      source.quality,
      source.label,
    ].filter(Boolean).join(" · ");
    button.textContent = label;
    button.addEventListener("click", () => {
      void playSource(selection.channel, source);
    });
    sourcesContainer.append(button);
  });
}

async function playSource(channel: Channel, source: Source) {
  if (!player) return;
  activeChannelId = channel.id;
  activeSourceId = source.id;
  playerState = { phase: "connecting", message: "El motor está buscando pares.", telemetry: null };
  renderList();
  renderStage();
  await player.play(source.acestreamId, channel.name);
}

async function removeChannel(id: string) {
  if (!api) return;
  if (pendingRemove !== id) {
    pendingRemove = id;
    renderList();
    return;
  }
  pendingRemove = null;
  try {
    if (activeChannelId === id) {
      await stopPlayback();
    }
    catalog = await api.removeChannel(id);
    renderList();
    renderStage();
  } catch (error) {
    catalogError.hidden = false;
    catalogError.textContent = error instanceof Error ? error.message : "No se ha podido quitar.";
  }
}

function visibleChannels(): { channel: Channel; primary: Source; sources: Source[] }[] {
  const rows = catalog.channels.flatMap((channel) => {
    const sources = channelSources(channel.id);
    const primary = sources[0];
    return primary ? [{ channel, primary, sources }] : [];
  }).filter((item) => matchesQuery(item.channel, query));
  if (group === "Todos") return rows;
  return rows.filter((item) => item.channel.group === group);
}

function channelSources(channelId: string): Source[] {
  const rank: Record<string, number> = { "4K": 4, FHD: 3, HD: 2, SD: 1 };
  const sources = catalog.sources.filter((source) => source.channelId === channelId);
  sources.sort((a, b) => (rank[b.quality ?? ""] ?? 0) - (rank[a.quality ?? ""] ?? 0) || a.priority - b.priority);
  return sources;
}

function activeSelection(): { channel: Channel; source: Source; sources: Source[] } | null {
  if (!activeChannelId) return null;
  const channel = catalog.channels.find((item) => item.id === activeChannelId);
  if (!channel) return null;
  const sources = channelSources(channel.id);
  const source = sources.find((item) => item.id === activeSourceId) ?? sources[0];
  if (!source) return null;
  return { channel, source, sources };
}

function nextSourceForActive(): { channel: Channel; source: Source } | null {
  const current = activeSelection();
  if (!current || current.sources.length <= 1) return null;
  const index = current.sources.findIndex((item) => item.id === current.source.id);
  const next = current.sources[(index + 1) % current.sources.length];
  return next ? { channel: current.channel, source: next } : null;
}

function formatTelemetry(telemetry: SessionTelemetry | null): string {
  if (!telemetry) return "";
  const parts: string[] = [];
  if (telemetry.status === "prebuf") {
    parts.push(telemetry.progress !== null && telemetry.progress > 0 ? `Preparando ${Math.round(telemetry.progress)} %` : "Preparando");
  } else if (telemetry.status === "dl") {
    parts.push("Recibiendo señal");
  } else if (telemetry.status) {
    parts.push(telemetry.status);
  }
  if (telemetry.peers !== null) {
    parts.push(`${telemetry.peers} ${telemetry.peers === 1 ? "par" : "pares"}`);
  }
  if (telemetry.speedDown !== null && telemetry.speedDown > 0) {
    parts.push(`${Math.round(telemetry.speedDown)} KB/s`);
  }
  return parts.join(" · ");
}

function chip(name: string, count: number, pressed: boolean): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-pressed", pressed ? "true" : "false");
  button.textContent = `${name} ${count}`;
  return button;
}

function slotFrom(target: HTMLElement, channelButtons: HTMLButtonElement[], groupButtons: HTMLButtonElement[]): Slot {
  if (target === search) return { zone: "search" };
  const groupIndex = groupButtons.indexOf(target as HTMLButtonElement);
  if (groupIndex >= 0) return { zone: "group", index: groupIndex };
  const channelIndex = channelButtons.indexOf(target as HTMLButtonElement);
  if (channelIndex >= 0) return { zone: "channel", index: channelIndex };
  if (target === settingsOpen) return { zone: "add" };
  return { zone: "stage" };
}

function focusSlot(slot: Slot, channelButtons: HTMLButtonElement[], groupButtons: HTMLButtonElement[]) {
  if (slot.zone === "search") search.focus();
  else if (slot.zone === "group") groupButtons[slot.index]?.focus();
  else if (slot.zone === "channel") channelButtons[slot.index]?.focus();
  else if (slot.zone === "add") settingsOpen.focus();
  else (stopButton.disabled ? fullscreenButton : stopButton).focus();
}

function sameSlot(left: Slot, right: Slot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isNavKey(key: string): boolean {
  return ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(key);
}

async function refreshEngine() {
  try {
    const response = await fetch("/health");
    const body = await response.json() as { engine?: { ok?: boolean; version?: string | null } };
    engine.textContent = body.engine?.ok
      ? `Motor en línea, ${body.engine.version ?? "sin versión"}`
      : "Motor sin respuesta";
  } catch {
    engine.textContent = "Motor sin respuesta";
  }
}

function tickClock() {
  const text = formatMadridClock(new Date());
  clock.textContent = text;
  clock.setAttribute("aria-label", `Hora de Madrid, ${text}`);
}

function applyStoredTheme() {
  const storedTheme = localStorage.getItem(THEME_KEY);
  if (storedTheme === "light" || storedTheme === "dark") document.documentElement.dataset.theme = storedTheme;
  syncThemeButton();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncThemeButton);
}

function syncThemeButton() {
  const dark = resolvedTheme() === "dark";
  themeButton.textContent = dark ? "Pasar a claro" : "Pasar a oscuro";
  if (themeColor) themeColor.content = dark ? "#0E0F11" : "#F4F4F2";
}

function resolvedTheme(): "light" | "dark" {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === "light" || explicit === "dark") return explicit;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function must<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Falta ${selector}`);
  return node;
}
