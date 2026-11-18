export function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Nombre sin sufijo de calidad, para agrupar variantes del mismo canal. */
export function channelKey(name: string): string {
  return normalize(name)
    .replace(/\b(4k|uhd|fhd|hd|sd|1080p|1080|720p|720|480p|480|360p)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesQuery(
  channel: { name: string; group: string; aliases: string[] },
  query: string,
): boolean {
  const q = normalize(query);
  if (!q) return true;
  const haystack = [channel.name, channel.group, ...channel.aliases].map(normalize).join(" ");
  return haystack.includes(q);
}
