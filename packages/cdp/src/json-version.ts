import { LoopbackBindPolicy } from "@tyto/core";
import { JsonRpcCdp, type CdpTransport } from "./jsonrpc.ts";
import { asRecord } from "./wire.ts";

export type OpenCdpSocket = (url: URL) => Promise<CdpTransport>;

/** Discover the browser-level CDP websocket. HTTP base and ws URL must be loopback. */
export async function debuggerUrlFromVersionEndpoint(httpBase: URL): Promise<URL> {
  new LoopbackBindPolicy().assertLoopback(httpBase.hostname);
  const version = new URL("/json/version", httpBase);
  const res = await fetch(version);
  if (!res.ok) throw new Error("json/version failed");
  const body = asRecord(await res.json());
  const raw = body?.webSocketDebuggerUrl;
  if (typeof raw !== "string" || !raw) throw new Error("json/version missing webSocketDebuggerUrl");
  const ws = new URL(raw);
  new LoopbackBindPolicy().assertLoopback(ws.hostname);
  if (ws.protocol !== "ws:" && ws.protocol !== "wss:") throw new Error("debugger url must be websocket");
  return ws;
}

/** HTTP `/json/version` then JSON-RPC on the debugger socket. Caller owns the socket factory. */
export async function connectCdp(httpBase: URL, open: OpenCdpSocket): Promise<JsonRpcCdp> {
  const ws = await debuggerUrlFromVersionEndpoint(httpBase);
  return new JsonRpcCdp(await open(ws));
}

/** Poll until `/json/version` is reachable. Success is HTTP 200, not the pause. */
export async function waitForJsonVersion(
  httpBase: URL,
  pause: (ms: number) => Promise<void>,
  tries = 40,
): Promise<void> {
  new LoopbackBindPolicy().assertLoopback(httpBase.hostname);
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(new URL("/json/version", httpBase));
      if (res.ok) return;
    } catch {
      // Chrome is not listening yet.
    }
    await pause(50);
  }
  throw new Error("json/version timeout");
}
