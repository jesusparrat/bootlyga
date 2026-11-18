import { normalize } from "./text.ts";

const RULES: { test: RegExp; group: string }[] = [
  { test: /\b(nfl|super bowl|futbol americano)\b/, group: "Fútbol americano" },
  { test: /\b(formula 1|\bf1\b|gran premio)\b/, group: "Fórmula 1" },
  { test: /\b(motogp|moto gp|worldsbk)\b/, group: "Motociclismo" },
  { test: /\b(nba|baloncesto|acb|euroliga)\b/, group: "Baloncesto" },
  { test: /\b(tenis|atp|wta|roland garros|wimbledon)\b/, group: "Tenis" },
  { test: /\b(laliga|champions|europa league|futbol|liga)\b/, group: "Fútbol" },
  { test: /\b(tdt|teledeporte|la 1|la 2|antena 3|telecinco)\b/, group: "Generalista" },
];

/** El grupo que escribe la persona gana. Si no hay, se sugiere por el nombre. */
export function suggestGroup(name: string, explicit?: string | null): string {
  const given = explicit?.trim();
  if (given) return given;
  const n = normalize(name);
  for (const rule of RULES) {
    if (rule.test.test(n)) return rule.group;
  }
  return "Otros";
}

export function groupCounts(channels: { group: string }[]): { name: string; count: number }[] {
  const map = new Map<string, number>();
  for (const channel of channels) {
    map.set(channel.group, (map.get(channel.group) ?? 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "es"))
    .map(([name, count]) => ({ name, count }));
}
