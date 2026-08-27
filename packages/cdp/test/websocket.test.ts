import { describe, expect, it } from "vitest";
import { openLoopbackWebSocket, type WebSocketCtor, type WebSocketLike } from "../src/websocket.ts";

class FakeSocket implements WebSocketLike {
  static constructed = 0;
  static last: FakeSocket | undefined;
  readonly sent: string[] = [];
  closed = false;
  private readonly handlers = new Map<string, Array<(ev: { data?: unknown }) => void>>();

  constructor(readonly href: string) {
    FakeSocket.constructed += 1;
    FakeSocket.last = this;
    queueMicrotask(() => this.emit("open", {}));
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  addEventListener(type: string, fn: (ev: { data?: unknown }) => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn);
    this.handlers.set(type, list);
  }

  emit(type: string, ev: { data?: unknown }): void {
    for (const fn of this.handlers.get(type) ?? []) fn(ev);
  }
}

describe("loopback WebSocket opener", () => {
  it("openLoopbackWebSocket refuses 0.0.0.0 before connecting", async () => {
    FakeSocket.constructed = 0;
    await expect(
      openLoopbackWebSocket(new URL("ws://0.0.0.0:9222/devtools/browser/x"), FakeSocket as unknown as WebSocketCtor),
    ).rejects.toThrow(/bind refused/i);
    expect(FakeSocket.constructed).toBe(0);
  });

  it("open socket: send and subscribe round-trip JSON text", async () => {
    FakeSocket.constructed = 0;
    const t = await openLoopbackWebSocket(
      new URL("ws://127.0.0.1:9222/devtools/browser/x"),
      FakeSocket as unknown as WebSocketCtor,
    );
    const got: string[] = [];
    t.subscribe((text) => got.push(text));
    t.send('{"id":1,"method":"Browser.getVersion"}');
    expect(FakeSocket.last?.sent).toEqual(['{"id":1,"method":"Browser.getVersion"}']);
    FakeSocket.last?.emit("message", { data: '{"id":1,"result":{"product":"Chrome"}}' });
    expect(got).toEqual(['{"id":1,"result":{"product":"Chrome"}}']);
  });

  it("transport.close closes the socket", async () => {
    const t = await openLoopbackWebSocket(
      new URL("ws://127.0.0.1:9222/devtools/browser/x"),
      FakeSocket as unknown as WebSocketCtor,
    );
    t.close?.();
    expect(FakeSocket.last?.closed).toBe(true);
  });
});
