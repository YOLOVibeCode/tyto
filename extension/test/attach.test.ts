import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  autoAttachDebugger,
  handleNativeMessage,
  onPageMessage,
} from "../native-protocol.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("ATTACH extension protocol", () => {
  it("native message { type: \"cdp\", method, params } only from host", async () => {
    const sent: Array<{ method: string; params: unknown }> = [];
    const out = await handleNativeMessage(
      { type: "cdp", method: "Runtime.evaluate", params: { expression: "1" } },
      {
        senderId: "tyto.example.extension",
        expectedExtensionId: "tyto.example.extension",
        sendCdp: async (method, params) => {
          sent.push({ method, params });
          return { ok: true };
        },
      },
    );
    expect(out).toEqual({ ok: true });
    expect(sent).toEqual([{ method: "Runtime.evaluate", params: { expression: "1" } }]);
  });

  it("{ type: \"fromPage\" } is ignored / never defined", async () => {
    const sent: unknown[] = [];
    const out = await handleNativeMessage(
      { type: "fromPage", method: "Runtime.evaluate" },
      {
        senderId: "tyto.example.extension",
        expectedExtensionId: "tyto.example.extension",
        sendCdp: async (method) => {
          sent.push(method);
          return {};
        },
      },
    );
    expect(out).toEqual({ ignored: true });
    expect(sent).toEqual([]);
    expect(readFileSync(join(ROOT, "native-protocol.js"), "utf8")).not.toMatch(/FROM_PAGE|fromPage.*cdp/i);
  });

  it("content script has no browser.runtime message type that executes CDP", () => {
    expect(onPageMessage({ type: "cdp", method: "Input.dispatchMouseEvent" }, {})).toBe(false);
    const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8")) as {
      content_scripts?: unknown;
    };
    expect(manifest.content_scripts).toBeUndefined();
    const bg = readFileSync(join(ROOT, "background.js"), "utf8");
    expect(bg).not.toMatch(/window\.tyto/);
  });

  it("chrome.debugger.attach auto on target tab", async () => {
    const attached: Array<{ tabId: number; protocol: string }> = [];
    const chromeFake = {
      debugger: {
        attach: async (target: { tabId: number }, protocol: string) => {
          attached.push({ tabId: target.tabId, protocol });
        },
      },
    };
    await autoAttachDebugger(chromeFake, 17);
    expect(attached).toEqual([{ tabId: 17, protocol: "1.3" }]);
  });
});
