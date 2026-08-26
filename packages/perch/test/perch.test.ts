import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { OriginAllowlist, type Navigation } from "@tyto/core";
import { FakeOccupancy, MemorySessionStore } from "@tyto/core/testing";
import { FilesystemSessionStore } from "@tyto/fs";
import { listen, type HostServer, type ListenConfig } from "@tyto/host";
import { TytoClient } from "@tyto/sdk";
import { PerchController } from "../src/index.ts";

const TOKEN = "t".repeat(32);
const SRC = fileURLToPath(new URL("../src", import.meta.url));

class SpyNavigation implements Navigation {
  async goto(_url: URL): Promise<void> {}
  async currentUrl(): Promise<URL> {
    return new URL("about:blank");
  }
}

describe("Perch as SDK client", () => {
  const servers: HostServer[] = [];
  afterEach(async () => {
    while (servers.length) await servers.pop()?.close();
  });

  async function boot(overrides: Partial<ListenConfig> = {}) {
    const server = await listen({
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      sessions: new MemorySessionStore(),
      allowlist: new OriginAllowlist(),
      navigation: new SpyNavigation(),
      occupancy: new FakeOccupancy(),
      ...overrides,
    });
    servers.push(server);
    return server;
  }

  it("paste goal writes session then starts loop", async () => {
    const server = await boot();
    const started: string[] = [];
    const perch = new PerchController({
      client: new TytoClient({ url: server.url, token: TOKEN }),
      startLoop: async (id) => {
        started.push(id);
      },
    });
    const id = await perch.paste("find barn owl conservation status", "owl-1");
    expect(id).toBe("owl-1");
    expect(started).toEqual(["owl-1"]);
    const opened = (await new TytoClient({ url: server.url, token: TOKEN }).call("session.open", {
      id: "owl-1",
    })) as { goal: string };
    expect(opened.goal).toBe("find barn owl conservation status");
  });

  it("kill Perch process; session file intact; second Perch resume continues", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tyto-perch-"));
    const server = await boot({ sessions: new FilesystemSessionStore(dir) });
    const first = new PerchController({
      client: new TytoClient({ url: server.url, token: TOKEN }),
      startLoop: async () => undefined,
    });
    await first.paste("still here after crash", "keep");
    first.dispose();
    const disk = await readFile(join(dir, "keep.json"), "utf8");
    expect(disk).toContain("still here after crash");
    const second = new PerchController({
      client: new TytoClient({ url: server.url, token: TOKEN }),
      startLoop: async () => undefined,
    });
    const resumed = (await second.resume("keep")) as { goal: string };
    expect(resumed.goal).toBe("still here after crash");
  });

  it("Stop button calls operator.interrupt", async () => {
    const occupancy = new FakeOccupancy();
    const server = await boot({ occupancy });
    const perch = new PerchController({
      client: new TytoClient({ url: server.url, token: TOKEN }),
      startLoop: async () => undefined,
    });
    await perch.stop();
    expect(occupancy.interrupted).toBe(true);
  });

  it("Perch bundle does not import @tyto/cdp", () => {
    for (const name of readdirSync(SRC)) {
      if (!name.endsWith(".ts")) continue;
      const text = readFileSync(join(SRC, name), "utf8");
      expect(text, name).not.toMatch(/@tyto\/cdp/);
      expect(text, name).not.toMatch(/RawCdpPort|CredentialStorePort/);
    }
  });
});
