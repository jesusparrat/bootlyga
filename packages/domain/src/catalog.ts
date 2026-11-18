import { normalizeAceId } from "./ids.ts";
import {
  emptyCatalog,
  QUALITIES,
  SPORTS,
  type AgendaEvent,
  type Catalog,
  type Channel,
  type Quality,
  type Source,
  type SourceHealth,
  type Sport,
} from "./types.ts";

export class CatalogError extends Error {
  readonly code: "duplicate" | "invalid";

  constructor(message: string, code: "duplicate" | "invalid" = "invalid") {
    super(message);
    this.name = "CatalogError";
    this.code = code;
  }
}

export function parseCatalog(value: unknown): Catalog {
  if (!value || typeof value !== "object") throw new CatalogError("El catálogo no es un objeto.");
  const record = value as Record<string, unknown>;
  if (record.version !== 1) throw new CatalogError("Versión de catálogo no soportada.");
  const channels = asArray(record.channels, "channels").map(parseChannel);
  const sources = asArray(record.sources, "sources").map(parseSource);
  const events = asArray(record.events, "events").map(parseEvent);
  const ids = new Set(channels.map((channel) => channel.id));
  for (const source of sources) {
    if (!ids.has(source.channelId)) {
      throw new CatalogError("Hay una fuente sin canal.");
    }
  }
  return { version: 1, channels, sources, events };
}

export function sameCatalog(value: unknown): Catalog {
  try {
    return parseCatalog(value);
  } catch {
    return emptyCatalog();
  }
}

function parseChannel(value: unknown): Channel {
  const record = asRecord(value, "canal");
  return {
    id: asId(record.id, "canal"),
    name: asText(record.name, "nombre", 1, 80),
    aliases: asStringArray(record.aliases, "aliases"),
    group: asText(record.group, "grupo", 1, 40),
    broadcaster: asNullableText(record.broadcaster, "emisora", 60),
    sports: asSports(record.sports),
  };
}

function parseSource(value: unknown): Source {
  const record = asRecord(value, "fuente");
  const aceId = typeof record.acestreamId === "string" ? normalizeAceId(record.acestreamId) : null;
  if (!aceId) throw new CatalogError("Identificador Acestream no válido.");
  return {
    id: asId(record.id, "fuente"),
    channelId: asId(record.channelId, "canal de la fuente"),
    acestreamId: aceId,
    quality: asQuality(record.quality),
    label: asNullableText(record.label, "etiqueta", 40),
    priority: asInt(record.priority, 0),
    health: asHealth(record.health),
  };
}

function parseEvent(value: unknown): AgendaEvent {
  const record = asRecord(value, "evento");
  const timeKnown = record.timeKnown === true;
  const startsAt = typeof record.startsAt === "string" ? record.startsAt : "";
  if (timeKnown) {
    if (Number.isNaN(new Date(startsAt).getTime())) {
      throw new CatalogError("startsAt tiene que ser un instante UTC.");
    }
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(startsAt)) {
    throw new CatalogError("Sin hora, startsAt es una fecha YYYY-MM-DD.");
  }
  const confidence = record.confidence === "tentative" ? "tentative" : record.confidence === "confirmed" ? "confirmed" : null;
  if (!confidence) throw new CatalogError("confidence no válida.");
  const sport = asSport(record.sport);
  if (!sport) throw new CatalogError("deporte no válido.");
  return {
    id: asId(record.id, "evento"),
    sport,
    competition: asText(record.competition, "competición", 1, 80),
    title: asText(record.title, "título", 1, 120),
    home: asNullableText(record.home, "local", 80),
    away: asNullableText(record.away, "visitante", 80),
    startsAt,
    timeKnown,
    durationEstMin: record.durationEstMin == null ? null : asInt(record.durationEstMin, 0),
    broadcasters: asStringArray(record.broadcasters, "emisoras"),
    source: asText(record.source, "fuente del evento", 1, 80),
    confidence,
  };
}

function asHealth(value: unknown): SourceHealth {
  if (!value || typeof value !== "object") {
    return { checks: 0, ok: 0, lastOkAt: null };
  }
  const record = value as Record<string, unknown>;
  const lastOkAt = record.lastOkAt;
  if (lastOkAt != null && (typeof lastOkAt !== "string" || Number.isNaN(new Date(lastOkAt).getTime()))) {
    throw new CatalogError("lastOkAt no es una fecha.");
  }
  return {
    checks: asInt(record.checks ?? 0, 0),
    ok: asInt(record.ok ?? 0, 0),
    lastOkAt: typeof lastOkAt === "string" ? lastOkAt : null,
  };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CatalogError(`Un ${label} tiene que ser un objeto.`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new CatalogError(`${label} tiene que ser una lista.`);
  return value;
}

function asId(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new CatalogError(`Identificador de ${label} no válido.`);
  }
  return value;
}

function asText(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== "string") throw new CatalogError(`${label} tiene que ser texto.`);
  const text = value.trim();
  if (text.length < min || text.length > max) {
    throw new CatalogError(`${label} fuera de tamaño.`);
  }
  return text;
}

function asNullableText(value: unknown, label: string, max: number): string | null {
  if (value == null || value === "") return null;
  return asText(value, label, 1, max);
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new CatalogError(`${label} tiene que ser una lista.`);
  return value.map((item) => {
    if (typeof item !== "string") throw new CatalogError(`${label} contiene algo que no es texto.`);
    return item.trim();
  }).filter(Boolean);
}

function asSports(value: unknown): Sport[] {
  if (!Array.isArray(value)) throw new CatalogError("sports tiene que ser una lista.");
  return value.map((item) => {
    const sport = asSport(item);
    if (!sport) throw new CatalogError("deporte no válido.");
    return sport;
  });
}

function asSport(value: unknown): Sport | null {
  return typeof value === "string" && (SPORTS as readonly string[]).includes(value) ? (value as Sport) : null;
}

function asQuality(value: unknown): Quality | null {
  if (value == null || value === "") return null;
  if (typeof value === "string" && (QUALITIES as readonly string[]).includes(value)) return value as Quality;
  throw new CatalogError("calidad no válida.");
}

function asInt(value: unknown, min: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    throw new CatalogError("Se esperaba un entero.");
  }
  return value;
}
