import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { StreamEvent } from "@tyto/core";
import { StreamEventSource, agentBrowserSocketDir, type WebSocketLike } from "../src/index.ts";

/** Minimal stand-in for the global WebSocket. */
class FakeSocket implements WebSocketLike {
  static last: FakeSocket | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  closed = false;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    FakeSocket.last = this;
    queueMicrotask(() => this.onopen?.());
  }
  send(data: unknown): void {
    this.onmessage?.({ data });
  }
  close(): void {
    this.closed = true;
    this.onclose?.();
  }
}

async function collect(it: AsyncIterable<StreamEvent>, max: number): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const ev of it) {
    out.push(ev);
    if (out.length >= max) break;
  }
  return out;
}

describe("StreamEventSource", () => {
  it("reads the port file and yields parsed events, dropping frames", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tyto-stream-"));
    await writeFile(join(dir, "task-1.stream"), "54321\n");
    const source = new StreamEventSource({ socketDir: dir, WebSocketCtor: FakeSocket });
    const ac = new AbortController();
    const pending = collect(source.subscribe("task-1", ac.signal), 2);
    await new Promise((r) => setTimeout(r, 5));
    expect(FakeSocket.last?.url).toBe("ws://127.0.0.1:54321");
    FakeSocket.last?.send(JSON.stringify({ type: "frame", data: "…" }));
    FakeSocket.last?.send(JSON.stringify({ type: "command", id: "r1", action: "click", params: {} }));
    FakeSocket.last?.send("not json");
    FakeSocket.last?.send(JSON.stringify({ type: "result", id: "r1", action: "click" }));
    const events = await pending;
    expect(events.map((e) => e.type)).toEqual(["command", "result"]);
    ac.abort();
  });

  it("yields a closed event when the socket closes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tyto-stream-"));
    await writeFile(join(dir, "s.stream"), "1234");
    const source = new StreamEventSource({ socketDir: dir, WebSocketCtor: FakeSocket });
    const pending = collect(source.subscribe("s", new AbortController().signal), 5);
    await new Promise((r) => setTimeout(r, 5));
    FakeSocket.last?.close();
    expect(await pending).toEqual([{ type: "closed" }]);
  });

  it("aborting closes the socket and ends the stream", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tyto-stream-"));
    await writeFile(join(dir, "s.stream"), "1234");
    const ac = new AbortController();
    const pending = collect(new StreamEventSource({ socketDir: dir, WebSocketCtor: FakeSocket }).subscribe("s", ac.signal), 5);
    await new Promise((r) => setTimeout(r, 5));
    ac.abort();
    await pending;
    expect(FakeSocket.last?.closed).toBe(true);
  });

  it("a missing port file is a clear error", async () => {
    const source = new StreamEventSource({ socketDir: await mkdtemp(join(tmpdir(), "tyto-stream-")), WebSocketCtor: FakeSocket });
    await expect(collect(source.subscribe("nope", new AbortController().signal), 1)).rejects.toThrow(/no event stream for session nope/);
  });
});

describe("agentBrowserSocketDir", () => {
  it("follows agent-browser: AGENT_BROWSER_SOCKET_DIR, then XDG_RUNTIME_DIR/agent-browser, then ~/.agent-browser", () => {
    expect(agentBrowserSocketDir({ AGENT_BROWSER_SOCKET_DIR: "/s" }, "/home/u")).toBe("/s");
    expect(agentBrowserSocketDir({ XDG_RUNTIME_DIR: "/run/user/1" }, "/home/u")).toBe("/run/user/1/agent-browser");
    expect(agentBrowserSocketDir({}, "/home/u")).toBe("/home/u/.agent-browser");
    expect(agentBrowserSocketDir({ AGENT_BROWSER_NAMESPACE: "team a" }, "/home/u")).toBe("/home/u/.agent-browser/namespaces/team-a/run");
  });
});
