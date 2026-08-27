import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emptySession, OriginAllowlist, type Navigation } from "@tyto/core";
import {
  FakeActuation,
  FakeModel,
  FakeObservation,
  FakeOccupancy,
  FakePerception,
  MemorySessionStore,
} from "@tyto/core/testing";
import { FilesystemSessionStore } from "@tyto/fs";
import { RPC_ERROR } from "@tyto/protocol";
import { RpcError, TytoClient } from "@tyto/sdk";
import { listen, type HostServer, type ListenConfig } from "../src/index.ts";

const TOKEN = "t".repeat(32);

class SpyNavigation implements Navigation {
  gotoCalls = 0;
  async goto(_url: URL): Promise<void> {
    this.gotoCalls += 1;
  }
  async currentUrl(): Promise<URL> {
    return new URL("about:blank");
  }
}

function baseConfig(overrides: Partial<ListenConfig> = {}): ListenConfig {
  return {
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    sessions: new MemorySessionStore(),
    allowlist: new OriginAllowlist(),
    navigation: new SpyNavigation(),
    observation: new FakeObservation(),
    ...overrides,
  };
}

describe("host kernel", () => {
  const servers: HostServer[] = [];

  afterEach(async () => {
    while (servers.length) {
      await servers.pop()?.close();
    }
  });

  async function boot(overrides: Partial<ListenConfig> = {}): Promise<HostServer> {
    const server = await listen(baseConfig(overrides));
    servers.push(server);
    return server;
  }

  it("listen on 127.0.0.1; refuse 0.0.0.0 in config", async () => {
    await expect(listen(baseConfig({ bind: "0.0.0.0" }))).rejects.toThrow(/bind refused/i);
    const server = await boot({ bind: "127.0.0.1" });
    expect(server.bind).toBe("127.0.0.1");
    expect(server.port).toBeGreaterThan(0);
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/?$/);
  });

  it("request without token → error unauthorized", async () => {
    const server = await boot();
    const res = await fetch(server.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "session.list" }),
    });
    const body = (await res.json()) as { error?: { code: number; message: string } };
    expect(body.error?.message).toBe("unauthorized");
    expect(body.error?.code).toBe(RPC_ERROR.UNAUTHORIZED);
    expect(JSON.stringify(body)).not.toMatch(/stack|at\s+\w+\s+\(/);
  });

  it("wrong token → unauthorized", async () => {
    const server = await boot();
    const client = new TytoClient({ url: server.url, token: "n".repeat(32) });
    await expect(client.call("session.list")).rejects.toBeInstanceOf(RpcError);
    await expect(client.call("session.list")).rejects.toMatchObject({
      message: "unauthorized",
      code: RPC_ERROR.UNAUTHORIZED,
    });
  });

  it("page.goto to denied origin → policy error, Navigation spy 0", async () => {
    const navigation = new SpyNavigation();
    const server = await boot({
      navigation,
      allowlist: new OriginAllowlist(),
    });
    const client = new TytoClient({ url: server.url, token: TOKEN });
    await expect(client.call("page.goto", { url: "https://evil.test/" })).rejects.toMatchObject({
      message: "origin not allowed",
      code: RPC_ERROR.POLICY,
    });
    expect(navigation.gotoCalls).toBe(0);
  });

  it("session.save then new Host process session.open restores goal", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tyto-host-"));
    const goal = "find barn owl conservation status";
    const first = await boot({ sessions: new FilesystemSessionStore(dir) });
    const writer = new TytoClient({ url: first.url, token: TOKEN });
    await writer.call("session.save", { session: emptySession("owl-1", goal) });
    await first.close();
    servers.pop();

    const second = await boot({ sessions: new FilesystemSessionStore(dir) });
    const reader = new TytoClient({ url: second.url, token: TOKEN });
    const opened = (await reader.call("session.open", { id: "owl-1" })) as { goal: string };
    expect(opened.goal).toBe(goal);
  });

  it("disconnect client mid-run does not delete session file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tyto-host-"));
    const sessions = new FilesystemSessionStore(dir);
    const server = await boot({ sessions, observation: new FakeObservation() });
    const client = new TytoClient({ url: server.url, token: TOKEN });
    await client.call("session.save", { session: emptySession("keep", "still here") });
    const ac = new AbortController();
    const waiting = client.call("tape.wait", { timeoutMs: 8000 }, ac.signal);
    ac.abort();
    await waiting.catch(() => undefined);
    const disk = await readFile(join(dir, "keep.json"), "utf8");
    expect(disk).toContain("still here");
    const again = new TytoClient({ url: server.url, token: TOKEN });
    const opened = (await again.call("session.open", { id: "keep" })) as { goal: string };
    expect(opened.goal).toBe("still here");
  }, 10_000);

  it("session.run thinks once then trusted-clicks against fakes; plan persists", async () => {
    const perception = new FakePerception();
    const actuation = new FakeActuation();
    const model = new FakeModel();
    const occupancy = new FakeOccupancy();
    perception.currentUrl = "https://en.wikipedia.org/wiki/Main_Page";
    perception.seedUrl("https://en.wikipedia.org/wiki/Main_Page", [
      { nodeId: "1", childIds: ["2"], role: { value: "WebArea" }, name: { value: "Wikipedia" } },
      {
        nodeId: "2",
        parentId: "1",
        role: { value: "button" },
        name: { value: "Search" },
        backendDOMNodeId: 43,
      },
    ], "Wikipedia");
    model.canned = {
      text: JSON.stringify({
        rationale: "search",
        anchors: [],
        steps: [{ op: "click", role: "button", name: "Search" }],
      }),
    };
    const server = await boot({ perception, actuation, models: model, occupancy });
    const client = new TytoClient({ url: server.url, token: TOKEN });
    await client.call("session.save", { session: emptySession("owl-1", "search wikipedia") });
    await client.call("session.run", {
      id: "owl-1",
      frame: { tabId: "t", frameId: "main", origin: "https://en.wikipedia.org" },
    });
    expect(model.calls).toBe(1);
    expect(actuation.performed).toHaveLength(1);
    expect(actuation.performed[0]?.op).toBe("click");
    expect(actuation.performed[0]?.node).toBe(43);
    const opened = (await client.call("session.open", { id: "owl-1" })) as {
      plan: { steps: Array<{ op: string }> } | null;
    };
    expect(opened.plan?.steps[0]?.op).toBe("click");
  });
});
