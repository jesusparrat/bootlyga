const CLOCK = new Intl.DateTimeFormat("es-ES", {
  timeZone: "Europe/Madrid",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const WHEN = new Intl.DateTimeFormat("es-ES", {
  timeZone: "Europe/Madrid",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const DAY = new Intl.DateTimeFormat("es-ES", {
  timeZone: "Europe/Madrid",
  day: "numeric",
  month: "short",
});

export type MadridParts = {
  day: string;
  month: string;
  hour: string;
  minute: string;
};

export function madridParts(date: Date): MadridParts {
  const parts = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    day: "numeric",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { day: get("day"), month: get("month"), hour: get("hour"), minute: get("minute") };
}

export function formatMadridClock(date: Date): string {
  return CLOCK.format(date);
}

/**
 * Muestra un evento en Europe/Madrid.
 * Sin hora conocida no se imprime 00:00: la fecha, si existe, va con "hora por confirmar".
 */
export function formatMadrid(event: { startsAt: string; timeKnown: boolean }): string {
  if (!event.timeKnown) {
    const day = dateOnly(event.startsAt);
    return day ? `${DAY.format(day)}, hora por confirmar` : "hora por confirmar";
  }
  const date = new Date(event.startsAt);
  if (Number.isNaN(date.getTime())) return "hora por confirmar";
  return `${WHEN.format(date)} (Madrid)`;
}

function dateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return Number.isNaN(date.getTime()) ? null : date;
}
