import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptySession } from "@tyto/core";
import { FilesystemSessionStore } from "../src/index.ts";

describe("FilesystemSessionStore", () => {
  it("roundtrip in a temp dir", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tyto-fs-"));
    const store = new FilesystemSessionStore(dir);
    const s = emptySession("sess1", "goal");
    s.lastUrl = "https://example.com/";
    await store.save(s);
    const loaded = await store.load("sess1");
    expect(loaded?.goal).toBe("goal");
    const disk = await readFile(join(dir, "sess1.json"), "utf8");
    expect(disk).not.toMatch(/apiKey/);
    expect(disk).not.toMatch(/backendNodeId/);
  });
});
