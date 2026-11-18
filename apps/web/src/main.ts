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
import { ApiError, createApi, type Api } from "./api.ts";
import { createPlayer, type Player } from "./player.ts";

const TOKEN_KEY = "bootlyga.token";
const THEME_KEY = "bootlyga.theme";

const engine = must<HTMLElement>("#engine");
const themeButton = must<HTMLButtonElement>("#theme");
const boot = must<HTMLElement>("#boot");
const gate = must<HTMLFormElement>("#gate");
const gateError = must<HTMLElement>("#gate-error");
const app = must<HTMLElement>("#app");
const search = must<HTMLInputElement>("#search");
const groups = must<HTMLElement>("#groups");
const empty = must<HTMLElement>("#empty");
const catalogError = must<HTMLElement>("#catalog-error");
const channels = must<HTMLElement>("#channels");
const addForm = must<HTMLFormElement>("#add");
const addError = must<HTMLElement>("#add-error");
const importForm = must<HTMLFormElement>("#import-form");
const importResult = must<HTMLElement>("#import-result");
const stageKicker = must<HTMLElement>("#stage-kicker");
const stageTitle = must<HTMLElement>("#stage-title");
const stageStatus = must<HTMLElement>("#stage-status");
const clock = must<HTMLElement>("#clock");
const video = must<HTMLVideoElement>("#video");
const stopButton = must<HTMLButtonElement>("#stop");
const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

let catalog: Catalog = { version: 1, channels: [], sources: [], events: [] };
let query = "";
let group = "Todos";
let playingId: string | null = null;
let pendingRemove: string | null = null;
let api: Api | null = null;
let player: Player | null = null;

applyStoredTheme();
tickClock();
setInterval(tickClock, 30_000);
void refreshEngine();
setInterval(() => void refreshEngine(), 10_000);

themeButton.addEventListener("click", () => {
  const next = resolvedTheme() === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  document.documentElement.dataset.theme = next;
  syncThemeButton();
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
    renderList();
  }).catch((error: unknown) => {
    addError.textContent = error instanceof Error ? error.message : "No se ha podido añadir.";
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
    importResult.textContent = `${result.addedChannels} canales, ${result.addedSources} fuentes. ${result.skipped} líneas se han dejado fuera.`;
    renderList();
  }).catch((error: unknown) => {
    importResult.textContent = error instanceof Error ? error.message : "La lista no se ha incorporado.";
  });
});

stopButton.addEventListener("click", () => {
  void player?.stop().then(() => setStage("En espera", "Elige un canal", ""));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (pendingRemove) {
      pendingRemove = null;
      renderList();
    }
    if (event.target instanceof HTMLElement && event.target.matches("input, textarea, select")) event.target.blur();
  }
  const target = event.target;
  if (target instanceof HTMLElement && target.matches("input, textarea, select")) return;
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
  gate.hidden = true;
  app.hidden = true;
  gateError.textContent = "";
  api = createApi(token);
  player = createPlayer(video, api, token, (text) => {
    stageStatus.textContent = text;
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
  renderList();
}

function showGate() {
  boot.hidden = true;
  gate.hidden = false;
  app.hidden = true;
}

function renderList() {
  const visible = visibleChannels();
  const names = groupCounts(catalog.channels);
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
    ? "No hay canales en este aparato. Añade el identificador que ya tengas."
    : "Ningún canal coincide con la búsqueda.";
  catalogError.hidden = true;

  for (const item of visible) {
    const row = document.createElement("li");
    row.className = item.source.acestreamId === playingId ? "channel is-on" : "channel";
    const play = document.createElement("button");
    play.type = "button";
    play.className = "channel-play";
    const name = document.createElement("span");
    name.className = "channel-name";
    name.textContent = item.channel.name;
    const meta = document.createElement("span");
    meta.className = "channel-meta";
    meta.textContent = [item.source.quality, item.channel.group].filter(Boolean).join(" · ");
    play.append(name, meta);
    play.addEventListener("click", () => {
      void playChannel(item.channel, item.source);
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "channel-remove";
    remove.textContent = pendingRemove === item.channel.id ? "Confirmar" : "Quitar";
    remove.addEventListener("click", () => {
      void removeChannel(item.channel.id, item.source.acestreamId);
    });
    row.append(play, remove);
    channels.append(row);
  }
}

async function playChannel(channel: Channel, source: Source) {
  if (!player) return;
  playingId = source.acestreamId;
  stopButton.disabled = false;
  setStage("En reproducción", channel.name, "El motor está buscando pares.");
  renderList();
  await player.play(source.acestreamId, channel.name);
  if (player.currentAce() !== source.acestreamId) {
    playingId = player.currentAce();
    if (!playingId) setStage("En espera", "Elige un canal", stageStatus.textContent ?? "");
    renderList();
  }
}

async function removeChannel(id: string, aceId: string) {
  if (!api) return;
  if (pendingRemove !== id) {
    pendingRemove = id;
    renderList();
    return;
  }
  pendingRemove = null;
  try {
    if (playingId === aceId) {
      await player?.stop();
      playingId = null;
      setStage("En espera", "Elige un canal", "");
    }
    catalog = await api.removeChannel(id);
    renderList();
  } catch (error) {
    catalogError.hidden = false;
    catalogError.textContent = error instanceof Error ? error.message : "No se ha podido quitar.";
  }
}

function visibleChannels(): { channel: Channel; source: Source }[] {
  const rows = catalog.channels.flatMap((channel) => {
    const source = bestSource(channel.id);
    return source ? [{ channel, source }] : [];
  }).filter((item) => matchesQuery(item.channel, query));
  if (group === "Todos") return rows;
  return rows.filter((item) => item.channel.group === group);
}

function bestSource(channelId: string): Source | null {
  const rank: Record<string, number> = { "4K": 4, FHD: 3, HD: 2, SD: 1 };
  const sources = catalog.sources.filter((source) => source.channelId === channelId);
  sources.sort((a, b) => (rank[b.quality ?? ""] ?? 0) - (rank[a.quality ?? ""] ?? 0) || b.priority - a.priority);
  return sources[0] ?? null;
}

function chip(name: string, count: number, pressed: boolean): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-pressed", pressed ? "true" : "false");
  button.textContent = `${name} ${count}`;
  return button;
}

function setStage(kicker: string, title: string, status: string) {
  stageKicker.textContent = kicker;
  stageTitle.textContent = title;
  stageStatus.textContent = status;
  stopButton.disabled = kicker !== "En reproducción";
}

function slotFrom(target: HTMLElement, channelButtons: HTMLButtonElement[], groupButtons: HTMLButtonElement[]): Slot {
  if (target === search) return { zone: "search" };
  const groupIndex = groupButtons.indexOf(target as HTMLButtonElement);
  if (groupIndex >= 0) return { zone: "group", index: groupIndex };
  const channelIndex = channelButtons.indexOf(target as HTMLButtonElement);
  if (channelIndex >= 0) return { zone: "channel", index: channelIndex };
  if (addForm.contains(target)) return { zone: "add" };
  return { zone: "stage" };
}

function focusSlot(slot: Slot, channelButtons: HTMLButtonElement[], groupButtons: HTMLButtonElement[]) {
  if (slot.zone === "search") search.focus();
  else if (slot.zone === "group") groupButtons[slot.index]?.focus();
  else if (slot.zone === "channel") channelButtons[slot.index]?.focus();
  else if (slot.zone === "add") addForm.querySelector<HTMLButtonElement>("button")?.focus();
  else stopButton.focus();
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
