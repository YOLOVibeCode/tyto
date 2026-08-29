import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { OriginAllowlist, type Navigation } from "@tyto/core";
import { FakeObservation, MemorySessionStore } from "@tyto/core/testing";
import { CdpLauncher } from "@tyto/cdp";
import type { CdpTransport } from "@tyto/cdp";
import { TytoClient } from "@tyto/sdk";
import { listen, type HostServer, type ListenConfig } from "../src/index.ts";

const TOKEN = "t".repeat(32);

class SpyNavigation implements Navigation {
  async goto(_url: URL): Promise<void> {}
  async currentUrl(): Promise<URL> {
    return new URL("about:blank");
  }
}

describe("host browser.launch attaches CDP adapters", () => {
  const servers: HostServer[] = [];
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (servers.length) await servers.pop()?.close();
    while (closers.length) await closers.pop()?.();
  });

  async function serveVersion(): Promise<URL> {
    const server = createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/x" }));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("listen failed");
    closers.push(
      () =>
        new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
          server.closeAllConnections();
        }),
    );
    return new URL(`http://127.0.0.1:${addr.port}/`);
  }

  function axTransport(): CdpTransport {
    let deliver: ((text: string) => void) | undefined;
    return {
      send(text) {
        const req = JSON.parse(text) as { id: number; method: string };
        const result =
          req.method === "Accessibility.getFullAXTree"
            ? {
                nodes: [
                  { nodeId: "1", childIds: ["2"], role: { value: "WebArea" }, name: { value: "Wikipedia" } },
                  {
                    nodeId: "2",
                    parentId: "1",
                    role: { value: "button" },
                    name: { value: "Search" },
                    backendDOMNodeId: 43,
                  },
                ],
              }
            : req.method === "Target.getTargets"
              ? { targetInfos: [{ targetId: "page-1", type: "page", url: "about:blank" }] }
              : req.method === "Target.attachToTarget"
                ? { sessionId: "sid-page" }
                : req.method === "Target.createTarget"
                  ? { targetId: "page-1" }
                  : {};
        queueMicrotask(() => deliver?.(JSON.stringify({ id: req.id, result })));
      },
      subscribe(fn) {
        deliver = fn;
        return () => {
          deliver = undefined;
        };
      },
    };
  }

  it("browser.launch then page.snapshot is AX, not a screenshot", async () => {
    const http = await serveVersion();
    const launcher = new CdpLauncher({
      resolveBinary: async () => "/bin/chrome-fake",
      spawn: async () => ({ kill: () => undefined }),
      open: async () => axTransport(),
    });
    const cfg: ListenConfig = {
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      sessions: new MemorySessionStore(),
      allowlist: new OriginAllowlist(),
      navigation: new SpyNavigation(),
      observation: new FakeObservation(),
      launcher,
    };
    const server = await listen(cfg);
    servers.push(server);
    const client = new TytoClient({ url: server.url, token: TOKEN });
    await client.call("browser.launch", {
      browser: "chrome",
      userDataDir: "/tmp/tyto-profile",
      port: Number(http.port),
    });
    const snap = (await client.call("page.snapshot", {
      tabId: "t",
      frameId: "main",
      origin: "https://en.wikipedia.org",
    })) as { tree: string; refs: unknown };
    expect(snap.tree).toContain("Search");
    expect(JSON.stringify(snap)).not.toMatch(/screenshot|data:image/i);
  });

  it("browser.launch then page.goto uses Page.navigate after origin grant", async () => {
    const http = await serveVersion();
    const methods: string[] = [];
    let deliver: ((text: string) => void) | undefined;
    const launcher = new CdpLauncher({
      resolveBinary: async () => "/bin/chrome-fake",
      spawn: async () => ({ kill: () => undefined }),
      open: async () => ({
        send(text) {
          const req = JSON.parse(text) as { id: number; method: string };
          methods.push(req.method);
          const result =
            req.method === "Target.getTargets"
              ? { targetInfos: [{ targetId: "page-1", type: "page", url: "about:blank" }] }
              : req.method === "Target.attachToTarget"
                ? { sessionId: "sid-page" }
                : {};
          queueMicrotask(() => deliver?.(JSON.stringify({ id: req.id, result })));
        },
        subscribe(fn) {
          deliver = fn;
          return () => {
            deliver = undefined;
          };
        },
      }),
    });
    const allowlist = new OriginAllowlist();
    const server = await listen({
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      sessions: new MemorySessionStore(),
      allowlist,
      navigation: new SpyNavigation(),
      observation: new FakeObservation(),
      launcher,
    });
    servers.push(server);
    const client = new TytoClient({ url: server.url, token: TOKEN });
    await client.call("browser.launch", {
      browser: "chrome",
      userDataDir: "/tmp/tyto-profile",
      port: Number(http.port),
    });
    await client.call("operator.grantOrigin", { origin: "https://example.com" });
    await client.call("page.goto", { url: "https://example.com/" });
    expect(methods).toContain("Page.navigate");
    expect(methods).toContain("Runtime.addBinding");
    expect(methods).toContain("Page.addScriptToEvaluateOnNewDocument");
    expect(methods.join(" ")).not.toMatch(/Runtime\.evaluate/);
  });

  it("browser.openSteer opens Perch as a new tab; Go still navigates the work tab", async () => {
    const http = await serveVersion();
    const calls: Array<{ method: string; params?: Record<string, unknown>; sessionId?: string }> = [];
    let deliver: ((text: string) => void) | undefined;
    const launcher = new CdpLauncher({
      resolveBinary: async () => "/bin/chrome-fake",
      spawn: async () => ({ kill: () => undefined }),
      open: async () => ({
        send(text) {
          const req = JSON.parse(text) as {
            id: number;
            method: string;
            params?: Record<string, unknown>;
            sessionId?: string;
          };
          const rec: { method: string; params?: Record<string, unknown>; sessionId?: string } = {
            method: req.method,
          };
          if (req.params !== undefined) rec.params = req.params;
          if (req.sessionId !== undefined) rec.sessionId = req.sessionId;
          calls.push(rec);
          const result =
            req.method === "Target.getTargets"
              ? { targetInfos: [{ targetId: "page-1", type: "page", url: "about:blank" }] }
              : req.method === "Target.attachToTarget"
                ? { sessionId: "sid-page" }
                : req.method === "Target.createTarget"
                  ? { targetId: "steer-tab" }
                  : {};
          queueMicrotask(() => deliver?.(JSON.stringify({ id: req.id, result })));
        },
        subscribe(fn) {
          deliver = fn;
          return () => {
            deliver = undefined;
          };
        },
      }),
    });
    const allowlist = new OriginAllowlist();
    const server = await listen({
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      sessions: new MemorySessionStore(),
      allowlist,
      navigation: new SpyNavigation(),
      observation: new FakeObservation(),
      launcher,
    });
    servers.push(server);
    const client = new TytoClient({ url: server.url, token: TOKEN });
    await client.call("browser.launch", {
      browser: "chrome",
      userDataDir: "/tmp/tyto-profile",
      port: Number(http.port),
    });
    const afterLaunch = calls.length;
    const result = (await client.call("browser.openSteer", {})) as { ok: boolean; targetId: string };
    expect(result).toMatchObject({ ok: true, targetId: "steer-tab" });
    const added = calls.slice(afterLaunch);
    expect(added.map((c) => c.method)).toEqual(["Target.createTarget"]);
    expect(added[0]?.params).toMatchObject({ url: server.url });
    expect(added[0]?.sessionId).toBeUndefined();
    expect(JSON.stringify(added)).not.toMatch(/Runtime\.evaluate/);

    await client.call("operator.grantOrigin", { origin: "https://example.com" });
    await client.call("page.goto", { url: "https://example.com/" });
    const nav = calls.find((c) => c.method === "Page.navigate");
    expect(nav?.sessionId).toBe("sid-page");
    expect(nav?.params).toMatchObject({ url: "https://example.com/" });
  });
});
