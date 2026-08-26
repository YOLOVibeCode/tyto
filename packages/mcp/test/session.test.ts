import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptySession } from "@tyto/core";
import { FilesystemSessionStore } from "@tyto/fs";
import { PERCH_SAFE_METHODS } from "@tyto/protocol";
import { disconnect, readSessionResource, toolNames } from "../src/index.ts";

describe("mcp adapter", () => {
  it("tool names ⊆ protocol Perch-safe set", () => {
    const names = toolNames();
    expect([...names]).toEqual([...PERCH_SAFE_METHODS]);
    for (const n of names) expect(PERCH_SAFE_METHODS).toContain(n);
  });

  it("no tool cdp_raw unless host flag (default off)", () => {
    expect(toolNames()).not.toContain("cdp_raw");
    expect(toolNames()).not.toContain("debug.cdp");
    expect(toolNames({ rawCdp: true })).toContain("cdp_raw");
    expect(toolNames({ rawCdp: true })).not.toContain("debug.cdp");
  });

  it("resources can read session file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tyto-mcp-"));
    const store = new FilesystemSessionStore(dir);
    await store.save(emptySession("owl-1", "extract barn owl status"));
    const doc = (await readSessionResource("tyto://session/owl-1", (id) => store.load(id))) as {
      goal: string;
    };
    expect(doc.goal).toBe("extract barn owl status");
    const raw = await readFile(join(dir, "owl-1.json"), "utf8");
    expect(raw).not.toMatch(/backendNodeId/);
  });

  it("disconnect MCP, session remains", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tyto-mcp-"));
    const store = new FilesystemSessionStore(dir);
    await store.save(emptySession("keep", "do not delete me"));
    await disconnect();
    const disk = await readFile(join(dir, "keep.json"), "utf8");
    expect(disk).toContain("do not delete me");
    expect(await store.load("keep")).toMatchObject({ goal: "do not delete me" });
  });
});
