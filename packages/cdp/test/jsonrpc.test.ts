import { describe, expect, it } from "vitest";
import { CdpActuation } from "../src/actuation.ts";
import { JsonRpcCdp, type CdpTransport } from "../src/jsonrpc.ts";
import type { FrameRef } from "@tyto/core";

class QueueTransport implements CdpTransport {
  readonly sent: string[] = [];
  private listener: ((text: string) => void) | undefined;
  auto?: (req: Record<string, unknown>) => Record<string, unknown>;

  send(text: string): void {
    this.sent.push(text);
    const req = JSON.parse(text) as Record<string, unknown>;
    if (this.auto) {
      queueMicrotask(() => this.listener?.(JSON.stringify(this.auto!(req))));
    }
  }

  subscribe(fn: (text: string) => void): () => void {
    this.listener = fn;
    return () => {
      this.listener = undefined;
    };
  }

  reply(text: string): void {
    this.listener?.(text);
  }
}

const FRAME: FrameRef = { tabId: "t", frameId: "main", origin: "https://en.wikipedia.org" };

describe("owned CDP JSON-RPC wire", () => {
  it("JSON-RPC send matches id to result", async () => {
    const t = new QueueTransport();
    const cdp = new JsonRpcCdp(t);
    const pending = cdp.send("Browser.getVersion");
    const req = JSON.parse(t.sent[0] ?? "{}") as { id: number; method: string };
    expect(req).toMatchObject({ id: 1, method: "Browser.getVersion" });
    t.reply(JSON.stringify({ id: 1, result: { product: "Chrome/122" } }));
    await expect(pending).resolves.toEqual({ product: "Chrome/122" });
  });

  it("sessionId is on the wire object, not inside params", async () => {
    const t = new QueueTransport();
    const cdp = new JsonRpcCdp(t);
    const pending = cdp.send("DOM.getBoxModel", { backendNodeId: 7 }, "sid-child");
    const req = JSON.parse(t.sent[0] ?? "{}") as Record<string, unknown>;
    expect(req.sessionId).toBe("sid-child");
    expect(req.params).toEqual({ backendNodeId: 7 });
    t.reply(JSON.stringify({ id: 1, result: { model: { content: [0, 0, 2, 0, 2, 2, 0, 2] } } }));
    await pending;
  });

  it("error response rejects with message, not a stack", async () => {
    const t = new QueueTransport();
    const cdp = new JsonRpcCdp(t);
    const pending = cdp.send("Runtime.evaluate", { expression: "1" });
    t.reply(JSON.stringify({ id: 1, error: { code: -32000, message: "session closed" } }));
    await expect(pending).rejects.toMatchObject({ message: "session closed" });
  });

  it("event without id does not settle a pending call", async () => {
    const t = new QueueTransport();
    const cdp = new JsonRpcCdp(t);
    let settled = false;
    const pending = cdp.send("Browser.getVersion").then((r) => {
      settled = true;
      return r;
    });
    t.reply(JSON.stringify({ method: "Target.attachedToTarget", params: { sessionId: "x" } }));
    await Promise.resolve();
    expect(settled).toBe(false);
    t.reply(JSON.stringify({ id: 1, result: { product: "Chrome" } }));
    await expect(pending).resolves.toEqual({ product: "Chrome" });
  });

  it("JsonRpcCdp is a CdpWire: trusted click uses box model, not evaluate", async () => {
    const t = new QueueTransport();
    t.auto = (req) => {
      if (req.method === "DOM.getBoxModel") {
        return { id: req.id, result: { model: { content: [0, 0, 20, 0, 20, 20, 0, 20] } } };
      }
      return { id: req.id, result: {} };
    };
    const act = new CdpActuation(new JsonRpcCdp(t));
    await act.perform({ op: "click", node: 42, frame: FRAME });
    const methods = t.sent.map((s) => (JSON.parse(s) as { method: string }).method);
    expect(methods).toContain("DOM.getBoxModel");
    expect(methods.filter((m) => m === "Input.dispatchMouseEvent")).toHaveLength(2);
    expect(methods).not.toContain("Runtime.evaluate");
  });
});
