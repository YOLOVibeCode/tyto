import { LoopbackBindPolicy } from "@tyto/core";
import type { CdpTransport } from "./jsonrpc.ts";

export type WebSocketLike = {
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "message" | "error" | "close", fn: (ev: { data?: unknown }) => void): void;
};

export type WebSocketCtor = new (url: string) => WebSocketLike;

/** Open a CDP websocket. Loopback only. `Socket` is injectable so tests never hit the network. */
export async function openLoopbackWebSocket(
  url: URL,
  Socket: WebSocketCtor = WebSocket as unknown as WebSocketCtor,
): Promise<CdpTransport> {
  new LoopbackBindPolicy().assertLoopback(url.hostname);
  if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new Error("debugger url must be websocket");

  return new Promise((resolve, reject) => {
    const ws = new Socket(url.href);
    const listeners = new Set<(text: string) => void>();
    let opened = false;
    ws.addEventListener("message", (ev) => {
      const text = typeof ev.data === "string" ? ev.data : "";
      for (const fn of listeners) fn(text);
    });
    ws.addEventListener("error", () => {
      if (!opened) reject(new Error("websocket error"));
    });
    ws.addEventListener("open", () => {
      opened = true;
      resolve({
        send(text: string): void {
          ws.send(text);
        },
        subscribe(fn: (text: string) => void): () => void {
          listeners.add(fn);
          return () => {
            listeners.delete(fn);
          };
        },
        close(): void {
          ws.close();
        },
      });
    });
  });
}
