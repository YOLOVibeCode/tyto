import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { PACK_FILES, packageExtension } from "./package-extension.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("extension pack", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
  });

  it("copies MV3 files and omits tests", async () => {
    const dest = await mkdtemp(join(tmpdir(), "tyto-ext-"));
    dirs.push(dest);
    await packageExtension({ repoRoot: REPO, destDir: dest });
    const names = await readdir(dest);
    expect(names.sort()).toEqual([...PACK_FILES].sort());
    expect(names).toContain("manifest.json");
    expect(names).not.toContain("test");
    expect(names).not.toContain("package.json");
    const manifest = JSON.parse(await readFile(join(dest, "manifest.json"), "utf8")) as {
      manifest_version: number;
      side_panel?: { default_path: string };
    };
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.side_panel?.default_path).toBe("sidepanel.html");
  });
});
