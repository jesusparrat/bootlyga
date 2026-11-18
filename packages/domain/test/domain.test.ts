import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addChannel,
  channelKey,
  detectQuality,
  emptyCatalog,
  formatMadrid,
  groupCounts,
  importM3u,
  madridParts,
  matchesQuery,
  moveFocus,
  normalizeAceId,
  parseCatalog,
  removeChannel,
  suggestGroup,
} from "../src/index.ts";

const ACE = "0123456789abcdef0123456789abcdef01234567";
const ACE_B = "abcdefabcdefabcdefabcdefabcdefabcdefabcd";

describe("identificador", () => {
  it("acepta hex y el esquema acestream", () => {
    assert.equal(normalizeAceId(ACE.toUpperCase()), ACE);
    assert.equal(normalizeAceId(`acestream://${ACE}`), ACE);
    assert.equal(normalizeAceId("no-es-un-id"), null);
    assert.equal(normalizeAceId(`${ACE}ff`), null);
  });
});

describe("hora de Madrid", () => {
  it("cambia con el horario de invierno y de verano", () => {
    const winter = madridParts(new Date("2026-01-15T18:00:00.000Z"));
    assert.deepEqual({ day: winter.day, hour: winter.hour, minute: winter.minute }, { day: "15", hour: "19", minute: "00" });
    const summer = madridParts(new Date("2026-07-15T18:00:00.000Z"));
    assert.deepEqual({ day: summer.day, hour: summer.hour, minute: summer.minute }, { day: "15", hour: "20", minute: "00" });
  });

  it("cruza la medianoche sin inventar la hora que falta", () => {
    const late = madridParts(new Date("2026-01-15T23:30:00.000Z"));
    assert.equal(late.day, "16");
    assert.equal(late.hour, "00");
    assert.equal(formatMadrid({ startsAt: "2026-11-18", timeKnown: false }).includes("00:00"), false);
    assert.match(formatMadrid({ startsAt: "2026-11-18", timeKnown: false }), /hora por confirmar/);
  });
});

describe("canales", () => {
  it("agrupa por nombre limpio y sugiere el grupo", () => {
    assert.equal(channelKey("Canal Demo FHD"), channelKey("Canal Demo HD"));
    assert.equal(suggestGroup("Partido NFL del domingo", ""), "Fútbol americano");
    assert.equal(suggestGroup("Cualquier cosa", "Mi grupo"), "Mi grupo");
    assert.equal(detectQuality("Señal FHD"), "FHD");
    assert.equal(detectQuality("Señal HD"), "HD");
  });

  it("importa solo acestream y conserva un evento", () => {
    const list = [
      "#EXTM3U",
      `#EXTINF:-1 tvg-id="Demo FHD" group-title="Fútbol",Canal Demo FHD`,
      `acestream://${ACE}`,
      `#EXTINF:-1 group-title="Fútbol",Canal Demo HD`,
      `acestream://${ACE_B}`,
      "#EXTINF:-1,Otra",
      "http://example.com/stream.m3u8",
    ].join("\n");
    const withEvent = {
      ...emptyCatalog(),
      events: [{
        id: "11111111-1111-4111-8111-111111111111",
        sport: "nfl" as const,
        competition: "NFL",
        title: "Partido",
        home: null,
        away: null,
        startsAt: "2026-11-18",
        timeKnown: false,
        durationEstMin: null,
        broadcasters: [],
        source: "manual",
        confidence: "tentative" as const,
      }],
    };
    const imported = importM3u(withEvent, list);
    assert.equal(imported.addedChannels, 1);
    assert.equal(imported.addedSources, 2);
    assert.equal(imported.skipped, 1);
    assert.equal(imported.catalog.events.length, 1);
    assert.equal(imported.catalog.channels[0]?.group, "Fútbol");
    const again = importM3u(imported.catalog, list);
    assert.equal(again.addedSources, 0);
    assert.equal(again.catalog.sources.length, 2);
    const removed = removeChannel(again.catalog, again.catalog.channels[0]?.id ?? "");
    assert.equal(removed.channels.length, 0);
    assert.equal(removed.events.length, 1);
    assert.equal(parseCatalog(removed).events[0]?.timeKnown, false);
  });

  it("busca sin acentos y cuenta grupos", () => {
    const added = addChannel(emptyCatalog(), { name: "Fórmula 1", acestreamId: ACE, group: "Fórmula 1" });
    assert.equal(matchesQuery(added.channel, "formula"), true);
    assert.deepEqual(groupCounts(added.catalog.channels), [{ name: "Fórmula 1", count: 1 }]);
  });
});

describe("mando", () => {
  it("baja por la lista y salta al vídeo con la derecha", () => {
    const counts = { groups: 2, channels: 2 };
    let slot = moveFocus({ zone: "search" }, "ArrowDown", counts);
    assert.deepEqual(slot, { zone: "group", index: 0 });
    slot = moveFocus(slot, "ArrowDown", counts);
    slot = moveFocus(slot, "ArrowDown", counts);
    assert.deepEqual(slot, { zone: "channel", index: 0 });
    slot = moveFocus(slot, "ArrowRight", counts);
    assert.deepEqual(slot, { zone: "stage" });
    slot = moveFocus(slot, "ArrowLeft", counts);
    assert.deepEqual(slot, { zone: "channel", index: 0 });
    assert.deepEqual(moveFocus(slot, "Home", counts), { zone: "search" });
  });
});
