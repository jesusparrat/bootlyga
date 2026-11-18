import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { emptyCatalog, parseCatalog, type Catalog } from "@bootlyga/domain";

export type CatalogStore = {
  read(): Promise<Catalog>;
  change<T>(fn: (catalog: Catalog) => Promise<{ catalog: Catalog; value: T }> | { catalog: Catalog; value: T }): Promise<T>;
};

export function createCatalogStore(filePath: string): CatalogStore {
  let tail: Promise<void> = Promise.resolve();

  async function read(): Promise<Catalog> {
    try {
      const text = await readFile(filePath, "utf8");
      return parseCatalog(JSON.parse(text) as unknown);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return emptyCatalog();
      throw error;
    }
  }

  async function write(catalog: Catalog): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(catalog, null, 2)}\n`);
    await rename(tmp, filePath);
  }

  return {
    read,
    change(fn) {
      const run = tail.then(async () => {
        const current = await read();
        const result = await fn(current);
        await write(parseCatalog(result.catalog));
        return result.value;
      });
      tail = run.then(() => undefined, () => undefined);
      return run;
    },
  };
}
