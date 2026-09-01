import { afterEach, describe, expect, it } from "vitest";
import { OriginAllowlist, type Attacher, type AttachOpts, type BrowserHandle, type Navigation } from "@tyto/core";
import { FakeObservation, FakePerception, MemorySessionStore } from "@tyto/core/testing";
import { TytoClient } from "@tyto/sdk";
import { listen, type HostServer } from "../src/index.ts";

const TOKEN = "t".repeat(32);

class SpyNavigation implements Navigation {
  async goto(_url: URL): Promise<void> {}
  async currentUrl(): Promise<URL> {
    return new URL("about:blank");
  }
}

describe("host browser.attach", () => {
  const servers: HostServer[] = [];
  afterEach(async () => {
    while (servers.length) await servers.pop()?.close();
  });

  it("browser.attach without attacher fails closed", async () => {
    const server = await listen({
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      sessions: new MemorySessionStore(),
      allowlist: new OriginAllowlist(),
      navigation: new SpyNavigation(),
    });
    servers.push(server);
    const client = new TytoClient({ url: server.url, token: TOKEN });
    await expect(client.call("browser.attach", { tabId: "17" })).rejects.toThrow(/attacher not attached/i);
  });

  it("browser.attach requires tabId then binds perception to the attached handle", async () => {
    const perception = new FakePerception();
    perception.currentUrl = "https://en.wikipedia.org/";
    perception.seedUrl(
      "https://en.wikipedia.org/",
      [
        { nodeId: "1", childIds: ["2"], role: { value: "WebArea" }, name: { value: "Wikipedia" } },
        {
          nodeId: "2",
          parentId: "1",
          role: { value: "button" },
          name: { value: "Search" },
          backendDOMNodeId: 43,
        },
      ],
      "Wikipedia",
    );
    const attached: AttachOpts[] = [];
    const attacher: Attacher = {
      async attach(opts) {
        attached.push(opts);
        const handle: BrowserHandle = { disconnect: async () => undefined };
        return handle;
      },
    };
    const server = await listen({
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      sessions: new MemorySessionStore(),
      allowlist: new OriginAllowlist(),
      navigation: new SpyNavigation(),
      observation: new FakeObservation(),
      perception,
      attacher,
    });
    servers.push(server);
    const client = new TytoClient({ url: server.url, token: TOKEN });
    await expect(client.call("browser.attach", {})).rejects.toThrow(/tabId required/i);
    await client.call("browser.attach", { tabId: "17" });
    expect(attached).toEqual([{ tabId: "17" }]);
    const snap = (await client.call("page.snapshot", {
      tabId: "t",
      frameId: "main",
      origin: "https://en.wikipedia.org",
    })) as { tree: string };
    expect(snap.tree).toContain("Search");
    expect(JSON.stringify(snap)).not.toMatch(/screenshot|data:image/i);
  });
});
