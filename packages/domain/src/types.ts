export const SPORTS = ["nfl", "football", "f1", "motogp", "nba", "tennis", "other"] as const;
export type Sport = (typeof SPORTS)[number];

export const QUALITIES = ["SD", "HD", "FHD", "4K"] as const;
export type Quality = (typeof QUALITIES)[number];

export type SourceHealth = {
  checks: number;
  ok: number;
  /** ISO-8601 en UTC, o null si aún no hubo un acierto. */
  lastOkAt: string | null;
};

export type Source = {
  id: string;
  channelId: string;
  acestreamId: string;
  quality: Quality | null;
  label: string | null;
  priority: number;
  health: SourceHealth;
};

export type Channel = {
  id: string;
  name: string;
  aliases: string[];
  group: string;
  broadcaster: string | null;
  sports: Sport[];
};

/**
 * Evento de la agenda. Se guarda la hora en UTC.
 * Si la fuente no trae hora, timeKnown es false y startsAt es solo la fecha (YYYY-MM-DD):
 * no se inventa la medianoche.
 */
export type AgendaEvent = {
  id: string;
  sport: Sport;
  competition: string;
  title: string;
  home: string | null;
  away: string | null;
  startsAt: string;
  timeKnown: boolean;
  durationEstMin: number | null;
  broadcasters: string[];
  source: string;
  confidence: "confirmed" | "tentative";
};

export type Catalog = {
  version: 1;
  channels: Channel[];
  sources: Source[];
  events: AgendaEvent[];
};

export function emptyCatalog(): Catalog {
  return { version: 1, channels: [], sources: [], events: [] };
}
