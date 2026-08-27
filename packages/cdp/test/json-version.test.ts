import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { debuggerUrlFromVersionEndpoint, connectCdp } from "../src/json-version.ts";
import type { CdpTransport } from "../src/jsonrpc.ts";

describe("CDP /json/version discovery", () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (closers.length) await closers.pop()?.();
  });

  async function serve(body: unknown, bind = "127.0.0.1"): Promise<URL> {
    const server = createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, bind, () => resolve());
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

  it("GET /json/version on 127.0.0.1 returns debugger websocket URL", async () => {
    const base = await serve({
      Browser: "Chrome/122",
      webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/abc",
    });
    const ws = await debuggerUrlFromVersionEndpoint(base);
    expect(ws.protocol).toBe("ws:");
    expect(ws.hostname).toBe("127.0.0.1");
    expect(ws.pathname).toBe("/devtools/browser/abc");
  });

  it("webSocketDebuggerUrl on 0.0.0.0 is refused", async () => {
    const base = await serve({
      webSocketDebuggerUrl: "ws://0.0.0.0:9222/devtools/browser/abc",
    });
    await expect(debuggerUrlFromVersionEndpoint(base)).rejects.toThrow(/bind refused|loopback/i);
  });

  it("HTTP base 0.0.0.0 is refused before fetch", async () => {
    await expect(debuggerUrlFromVersionEndpoint(new URL("http://0.0.0.0:9222/"))).rejects.toThrow(
      /bind refused/i,
    );
  });

  it("connectCdp fetches /json/version then speaks JSON-RPC on the debugger URL", async () => {
    const base = await serve({
      webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/abc",
    });
    const opened: string[] = [];
    const sent: string[] = [];
    let deliver: ((text: string) => void) | undefined;
    const transport: CdpTransport = {
      send(text) {
        sent.push(text);
        const req = JSON.parse(text) as { id: number };
        queueMicrotask(() => deliver?.(JSON.stringify({ id: req.id, result: { product: "Chrome/122" } })));
      },
      subscribe(fn) {
        deliver = fn;
        return () => {
          deliver = undefined;
        };
      },
    };
    const cdp = await connectCdp(base, async (url) => {
      opened.push(url.href);
      return transport;
    });
    expect(opened[0]).toBe("ws://127.0.0.1:9222/devtools/browser/abc");
    await expect(cdp.send("Browser.getVersion")).resolves.toEqual({ product: "Chrome/122" });
    expect(JSON.parse(sent[0] ?? "{}")).toMatchObject({ method: "Browser.getVersion" });
  });
});
