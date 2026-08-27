import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { CdpLauncher, resolveBrowserBinary, spawnBrowser } from "../src/launcher.ts";
import type { CdpTransport } from "../src/jsonrpc.ts";
import { chromeLaunchArgs } from "../src/launch-args.ts";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

describe("CDP launcher", () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (closers.length) await closers.pop()?.();
  });

  async function serveVersion(wsUrl: string): Promise<URL> {
    const server = createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ webSocketDebuggerUrl: wsUrl }));
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

  function resultFor(method: string): unknown {
    if (method === "Target.getTargets") {
      return { targetInfos: [{ targetId: "page-1", type: "page", url: "about:blank" }] };
    }
    if (method === "Target.attachToTarget") return { sessionId: "sid-page" };
    if (method === "Target.createTarget") return { targetId: "page-1" };
    return {};
  }

  function autoTransport(): CdpTransport {
    let deliver: ((text: string) => void) | undefined;
    return {
      send(text) {
        const req = JSON.parse(text) as { id: number; method: string };
        queueMicrotask(() => deliver?.(JSON.stringify({ id: req.id, result: resultFor(req.method) })));
      },
      subscribe(fn) {
        deliver = fn;
        return () => {
          deliver = undefined;
        };
      },
    };
  }

  it("launch spawns with loopback debug args and disconnect kills the child", async () => {
    const http = await serveVersion("ws://127.0.0.1:9222/devtools/browser/x");
    const spawned: { binary: string; args: string[] }[] = [];
    let killed = 0;
    const launcher = new CdpLauncher({
      resolveBinary: async () => "/bin/chrome-fake",
      spawn: async (binary, args) => {
        spawned.push({ binary, args });
        return { kill: () => { killed += 1; } };
      },
      open: async (url) => {
        expect(url.hostname).toBe("127.0.0.1");
        return autoTransport();
      },
    });
    const handle = await launcher.launch({
      browser: "chrome",
      userDataDir: "/tmp/tyto-profile",
      port: Number(http.port),
      bindHost: "127.0.0.1",
    });
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.binary).toBe("/bin/chrome-fake");
    expect(spawned[0]?.args).toEqual(
      chromeLaunchArgs({
        browser: "chrome",
        userDataDir: "/tmp/tyto-profile",
        port: Number(http.port),
        bindHost: "127.0.0.1",
      }),
    );
    expect(spawned[0]?.args.some((a) => a === "--remote-debugging-address=127.0.0.1")).toBe(true);
    expect(handle.pageSessionId).toBe("sid-page");
    await handle.disconnect();
    expect(killed).toBe(1);
  });

  it("launch on 0.0.0.0 does not spawn", async () => {
    let spawned = 0;
    const launcher = new CdpLauncher({
      resolveBinary: async () => "/bin/chrome-fake",
      spawn: async () => {
        spawned += 1;
        return { kill: () => undefined };
      },
      open: async () => autoTransport(),
    });
    await expect(
      launcher.launch({
        browser: "chrome",
        userDataDir: "/tmp/tyto-profile",
        port: 9222,
        bindHost: "0.0.0.0",
      }),
    ).rejects.toThrow(/bind refused/i);
    expect(spawned).toBe(0);
  });

  it("resolveBrowserBinary chrome on darwin uses Google Chrome.app when present", async () => {
    const path = await resolveBrowserBinary(
      "chrome",
      "darwin",
      async (p) => p === "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      async () => undefined,
    );
    expect(path).toBe("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  });

  it("default spawnBrowser refuses without TYTO_LIVE=1", async () => {
    const prev = process.env.TYTO_LIVE;
    delete process.env.TYTO_LIVE;
    try {
      expect(() => spawnBrowser("/bin/chrome-fake", [])).toThrow(/TYTO_LIVE/i);
    } finally {
      if (prev === undefined) delete process.env.TYTO_LIVE;
      else process.env.TYTO_LIVE = prev;
    }
  });

  it("launcher source does not import playwright", () => {
    for (const name of readdirSync(SRC)) {
      if (!name.endsWith(".ts")) continue;
      const text = readFileSync(join(SRC, name), "utf8");
      expect(text, name).not.toMatch(/playwright/i);
    }
  });
});
