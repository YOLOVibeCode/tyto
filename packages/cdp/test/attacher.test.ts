import { describe, expect, it } from "vitest";
import { ExtensionAttacher } from "../src/attacher.ts";

describe("ExtensionAttacher", () => {
  it("tabId required: attach does not silently pick a tab", async () => {
    const posted: unknown[] = [];
    const attacher = new ExtensionAttacher(async (msg) => {
      posted.push(msg);
      return { ok: true };
    });
    await expect(attacher.attach({})).rejects.toThrow(/tabId required/i);
    await expect(attacher.attach({ tabId: "0" })).rejects.toThrow(/tabId required/i);
    expect(posted).toEqual([]);
  });

  it("attach posts { type: attach } then CDP wire never uses Runtime.evaluate", async () => {
    const posted: unknown[] = [];
    const attacher = new ExtensionAttacher(async (msg) => {
      posted.push(msg);
      const rec = msg as { type?: string; method?: string };
      if (rec.type === "attach") return { ok: true };
      if (rec.type === "cdp" && rec.method === "DOM.getBoxModel") {
        return { model: { content: [0, 0, 20, 0, 20, 20, 0, 20] } };
      }
      return {};
    });
    const handle = await attacher.attach({ tabId: "17" });
    expect(posted).toEqual([{ type: "attach", tabId: 17 }]);
    const cdp = (handle as { cdp: { send: (m: string, p?: Record<string, unknown>) => Promise<unknown> } }).cdp;
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed" });
    expect(JSON.stringify(posted)).not.toMatch(/Runtime\.evaluate/);
    expect(posted.some((m) => (m as { type?: string }).type === "cdp")).toBe(true);
    await handle.disconnect();
    expect(posted.some((m) => (m as { type?: string }).type === "detach")).toBe(true);
  });
});
