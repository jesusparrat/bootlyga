import { suggestGroup } from "./group.ts";
import { normalizeAceId } from "./ids.ts";
import { detectQuality } from "./quality.ts";
import type { Quality } from "./types.ts";

export type ParsedEntry = {
  name: string;
  group: string;
  aceId: string;
  quality: Quality | null;
  aliases: string[];
};

export type ParseResult = {
  entries: ParsedEntry[];
  skipped: number;
};

type Pending = {
  name: string;
  group: string;
  quality: Quality | null;
  tvgId: string;
};

export function parseM3u(text: string): ParseResult {
  if (!text.includes("#EXTM3U")) {
    throw new Error("La lista no parece un m3u: falta #EXTM3U.");
  }

  const entries: ParsedEntry[] = [];
  let skipped = 0;
  let pending: Pending | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line === "#EXTM3U") continue;
    if (line.startsWith("#EXTINF:")) {
      pending = parseExtInf(line);
      continue;
    }
    if (line.startsWith("#")) continue;
    if (!pending) {
      skipped += 1;
      continue;
    }
    const aceId = normalizeAceId(line);
    if (!aceId) {
      skipped += 1;
      pending = null;
      continue;
    }
    const aliases = [pending.name];
    if (pending.tvgId && pending.tvgId !== pending.name) aliases.push(pending.tvgId);
    entries.push({
      name: pending.name || `Canal ${aceId.slice(0, 6)}`,
      group: suggestGroup(pending.name, pending.group),
      aceId,
      quality: pending.quality,
      aliases,
    });
    pending = null;
  }

  return { entries, skipped };
}

function parseExtInf(line: string): Pending {
  const comma = line.lastIndexOf(",");
  const name = comma >= 0 ? line.slice(comma + 1).trim() : "";
  const attrs = comma >= 0 ? line.slice(0, comma) : line;
  const group = attr(attrs, "group-title");
  const tvgId = attr(attrs, "tvg-id");
  const quality = detectQuality(tvgId) ?? detectQuality(name);
  return { name, group, quality, tvgId };
}

function attr(source: string, key: string): string {
  const match = source.match(new RegExp(`${key}=["']([^"']*)["']`, "i"));
  return match?.[1]?.trim() ?? "";
}
