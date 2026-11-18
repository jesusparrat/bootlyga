import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const skipDirs = new Set(["node_modules", "dist", ".git", "fixtures", "coverage", "third_party"]);
const textExt = new Set([".ts", ".js", ".mjs", ".css", ".html", ".md", ".yml", ".yaml", ".json", ".svg", ".webmanifest", ".sh"]);

describe("higiene", () => {
  it("no hay raya larga ni el identificador filtrado en el árbol de texto", () => {
    const hits: string[] = [];
    walk(root, (file, text) => {
      if (text.includes("\u2014")) hits.push(`raya larga en ${path.relative(root, file)}`);
      if (!file.endsWith(".test.ts") && text.includes("e572a5178ff72eed7d1d751a18b4b3419699f370")) {
        hits.push(`identificador filtrado en ${path.relative(root, file)}`);
      }
    });
    assert.deepEqual(hits, []);
  });
});

function walk(dir: string, visit: (file: string, text: string) => void) {
  for (const entry of readdirSync(dir)) {
    if (skipDirs.has(entry)) continue;
    const full = path.join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) {
      walk(full, visit);
      continue;
    }
    if (!textExt.has(path.extname(full))) continue;
    if (full.endsWith("package-lock.json")) continue;
    visit(full, readFileSync(full, "utf8"));
  }
}
