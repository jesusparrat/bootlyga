import type { Quality } from "./types.ts";

export function detectQuality(value: string): Quality | null {
  const s = value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  if (/\b(4k|uhd)\b/.test(s)) return "4K";
  if (/\b(fhd|1080p|1080)\b/.test(s)) return "FHD";
  if (/\b(hd|720p|720)\b/.test(s)) return "HD";
  if (/\b(sd|480p|480|360p)\b/.test(s)) return "SD";
  return null;
}
