import { CatalogError } from "./catalog.ts";
import { suggestGroup } from "./group.ts";
import { normalizeAceId } from "./ids.ts";
import { parseM3u } from "./m3u.ts";
import { channelKey } from "./text.ts";
import { QUALITIES, type Catalog, type Channel, type Quality, type Source } from "./types.ts";

export type ChannelInput = {
  name: string;
  group?: string | null;
  broadcaster?: string | null;
  aliases?: string[];
  acestreamId: string;
  quality?: string | null;
  label?: string | null;
};

export function addChannel(catalog: Catalog, input: ChannelInput): {
  catalog: Catalog;
  channel: Channel;
  source: Source;
  createdChannel: boolean;
} {
  const aceId = normalizeAceId(input.acestreamId);
  if (!aceId) throw new CatalogError("El identificador tiene que ser 40 caracteres hexadecimales.");
  const name = input.name.trim();
  if (name.length < 1 || name.length > 80) throw new CatalogError("El nombre no vale.");
  const group = suggestGroup(name, input.group);
  if (group.length > 40) throw new CatalogError("El grupo es demasiado largo.");
  const quality = parseQuality(input.quality);
  const key = channelKey(name);
  const existing = catalog.channels.find((channel) => channelKey(channel.name) === key && channel.group === group);
  if (existing && catalog.sources.some((source) => source.channelId === existing.id && source.acestreamId === aceId)) {
    throw new CatalogError("Ese identificador ya está en el canal.", "duplicate");
  }

  const aliases = unique([name, ...(input.aliases ?? []), ...(existing?.aliases ?? [])]);
  const channel: Channel = existing
    ? { ...existing, aliases }
    : {
        id: globalThis.crypto.randomUUID(),
        name,
        aliases,
        group,
        broadcaster: input.broadcaster?.trim() || null,
        sports: [],
      };
  const source: Source = {
    id: globalThis.crypto.randomUUID(),
    channelId: channel.id,
    acestreamId: aceId,
    quality,
    label: input.label?.trim() || null,
    priority: catalog.sources.filter((item) => item.channelId === channel.id).length,
    health: { checks: 0, ok: 0, lastOkAt: null },
  };
  const channels = existing
    ? catalog.channels.map((item) => (item.id === channel.id ? channel : item))
    : [...catalog.channels, channel];
  return {
    catalog: { ...catalog, channels, sources: [...catalog.sources, source] },
    channel,
    source,
    createdChannel: !existing,
  };
}

export function importM3u(catalog: Catalog, text: string): {
  catalog: Catalog;
  addedChannels: number;
  addedSources: number;
  skipped: number;
} {
  const parsed = parseM3u(text);
  let next = catalog;
  let addedChannels = 0;
  let addedSources = 0;
  let skipped = parsed.skipped;
  for (const entry of parsed.entries) {
    try {
      const added = addChannel(next, {
        name: entry.name,
        group: entry.group,
        aliases: entry.aliases,
        acestreamId: entry.aceId,
        quality: entry.quality,
      });
      next = added.catalog;
      if (added.createdChannel) addedChannels += 1;
      addedSources += 1;
    } catch (error) {
      if (error instanceof CatalogError && error.code === "duplicate") {
        skipped += 1;
        continue;
      }
      throw error;
    }
  }
  return { catalog: next, addedChannels, addedSources, skipped };
}

export function removeChannel(catalog: Catalog, id: string): Catalog {
  if (!catalog.channels.some((channel) => channel.id === id)) {
    throw new CatalogError("No existe ese canal.");
  }
  return {
    ...catalog,
    channels: catalog.channels.filter((channel) => channel.id !== id),
    sources: catalog.sources.filter((source) => source.channelId !== id),
  };
}

function parseQuality(value: string | null | undefined): Quality | null {
  if (value == null || value.trim() === "") return null;
  if ((QUALITIES as readonly string[]).includes(value)) return value as Quality;
  throw new CatalogError("calidad no válida.");
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = value.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}
