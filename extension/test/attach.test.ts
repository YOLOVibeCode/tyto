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

  it("hello from native host seeds session storage; token never from page", async () => {
    const stored: Record<string, string> = {};
    const sent: unknown[] = [];
    const { seedHostAuth } = await import("../native-protocol.js");
    const out = await seedHostAuth({
      sendNativeMessage: async (host: string, msg: unknown) => {
        sent.push({ host, msg });
        expect(host).toBe("com.noctusoft.tyto");
        return { type: "hello", port: "7420", token: "t".repeat(32) };
      },
      storage: {
        set: async (vals: Record<string, string>) => {
          Object.assign(stored, vals);
        },
      },
    });
    expect(out).toEqual({ ok: true });
    expect(sent).toEqual([{ host: "com.noctusoft.tyto", msg: { type: "hello" } }]);
    expect(stored.hostToken).toBe("t".repeat(32));
    expect(stored.hostPort).toBe("7420");
    expect(onPageMessage({ type: "hello", token: "t".repeat(32) }, {})).toBe(false);
    const html = readFileSync(join(ROOT, "sidepanel.html"), "utf8");
    expect(html).not.toContain("t".repeat(32));
    expect(html).not.toMatch(/sendNativeMessage|hostToken/);
    expect(readFileSync(join(ROOT, "background.js"), "utf8")).toMatch(/seedHostAuth/);
  });
});
