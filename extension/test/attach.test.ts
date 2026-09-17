import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  autoAttachDebugger,
  createDebuggerSession,
  handleNativeMessage,
  loopbackHttpUrl,
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
    const commands: string[] = [];
    const chromeFake = {
      debugger: {
        attach: async (target: { tabId: number }, protocol: string) => {
          attached.push({ tabId: target.tabId, protocol });
        },
        sendCommand: async (_target: { tabId: number }, method: string) => {
          commands.push(method);
        },
      },
    };
    await autoAttachDebugger(chromeFake, 17);
    expect(attached).toEqual([{ tabId: 17, protocol: "1.3" }]);
    expect(commands).toEqual([]);
  });

  it("CDP after attach targets the attached tab, not the active tab", async () => {
    const commands: Array<{ tabId: number; method: string }> = [];
    const chromeFake = {
      debugger: {
        attach: async () => undefined,
        sendCommand: async (target: { tabId: number }, method: string) => {
          commands.push({ tabId: target.tabId, method });
          return { ok: true };
        },
        detach: async () => undefined,
      },
      tabs: {
        query: async () => [{ id: 99 }],
      },
    };
    const session = createDebuggerSession(chromeFake);
    await session.attachDebugger(17);
    await session.sendCdp("Accessibility.getFullAXTree", {});
    expect(commands).toContainEqual({ tabId: 17, method: "Accessibility.getFullAXTree" });
    expect(commands).toContainEqual({ tabId: 17, method: "Accessibility.enable" });
    expect(commands.every((c) => c.tabId !== 99)).toBe(true);
    expect(readFileSync(join(ROOT, "background.js"), "utf8")).toMatch(/createDebuggerSession/);
  });

  it("chrome.debugger.attach refuses chrome:// tabs instead of hanging", async () => {
    const attached: number[] = [];
    const chromeFake = {
      tabs: {
        get: async (id: number) => ({ id, url: "chrome://newtab/" }),
      },
      debugger: {
        attach: async (target: { tabId: number }) => {
          attached.push(target.tabId);
        },
        sendCommand: async () => ({}),
      },
    };
    await expect(autoAttachDebugger(chromeFake, 1)).rejects.toThrow(/http\(s\) tab required/i);
    expect(attached).toEqual([]);
  });

  it("chrome.debugger.attach refuses a tab whose URL is not yet known", async () => {
    const chromeFake = {
      tabs: {
        get: async () => ({ id: 1, url: "" }),
      },
      debugger: {
        attach: async () => {
          throw new Error("should not attach");
        },
      },
    };
    await expect(autoAttachDebugger(chromeFake, 1)).rejects.toThrow(/tab url not ready/i);
  });

  it("loopbackHttpUrl allows only 127.0.0.1 http(s)", () => {
    expect(loopbackHttpUrl("http://127.0.0.1:9/attach.html")).toBe("http://127.0.0.1:9/attach.html");
    expect(loopbackHttpUrl("https://evil.test/")).toBe("");
    expect(loopbackHttpUrl("javascript:alert(1)")).toBe("");
    const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8")) as {
      host_permissions?: string[];
    };
    expect(manifest.host_permissions).toEqual(["http://127.0.0.1/*", "https://127.0.0.1/*"]);
    expect(readFileSync(join(ROOT, "background.js"), "utf8")).toMatch(/loopbackHttpUrl/);
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

  it("native { type: \"attach\", tabId } auto-attaches debugger; fromPage cannot attach", async () => {
    const attached: number[] = [];
    const ctx = {
      senderId: "tyto.example.extension",
      expectedExtensionId: "tyto.example.extension",
      sendCdp: async () => ({ ok: true }),
      attachDebugger: async (tabId: number) => {
        attached.push(tabId);
      },
    };
    const out = await handleNativeMessage({ type: "attach", tabId: 17 }, ctx);
    expect(out).toEqual({ ok: true });
    expect(attached).toEqual([17]);
    await expect(handleNativeMessage({ type: "attach" }, ctx)).resolves.toEqual({ error: "tabId required" });
    const ignored = await handleNativeMessage({ type: "fromPage", tabId: 17 }, ctx);
    expect(ignored).toEqual({ ignored: true });
    expect(attached).toEqual([17]);
  });
});
