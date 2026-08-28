import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { handlePanelMessage, scopeThisTab, scopeAllTabs } from "../sidepanel-sw.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function readExt(name: string): string {
  return readFileSync(join(ROOT, name), "utf8");
}

function readManifest(): Record<string, unknown> {
  return JSON.parse(readExt("manifest.json")) as Record<string, unknown>;
}

describe("manifest side panel", () => {
  it("has sidePanel permission", () => {
    const manifest = readManifest();
    expect(manifest.permissions).toContain("sidePanel");
  });

  it("has side_panel.default_path pointing to sidepanel.html", () => {
    const manifest = readManifest();
    const sp = manifest.side_panel as { default_path?: string } | undefined;
    expect(sp?.default_path).toBe("sidepanel.html");
  });

  it("has no content_scripts", () => {
    const manifest = readManifest();
    expect(manifest.content_scripts).toBeUndefined();
  });
});

describe("background.js side panel wiring", () => {
  it("calls setPanelBehavior openPanelOnActionClick = true", () => {
    const bg = readExt("background.js");
    expect(bg).toMatch(/setPanelBehavior/);
    expect(bg).toMatch(/openPanelOnActionClick.*true/);
  });

  it("has no window.tyto", () => {
    const bg = readExt("background.js");
    expect(bg).not.toMatch(/window\.tyto/);
  });

  it("does not expose token in panel html", () => {
    const html = readExt("sidepanel.html");
    expect(html).not.toMatch(/TYTO_HOST_TOKEN/);
    expect(html).not.toMatch(/tyto_at/);
  });
});

describe("sidepanel scope control", () => {
  it("This tab scope calls setOptions with tabId", async () => {
    const calls: Array<{ tabId?: number }> = [];
    const fakeSidePanel = {
      setOptions: async (opts: { tabId?: number }) => {
        calls.push(opts);
      },
    };
    await scopeThisTab(fakeSidePanel, 42);
    expect(calls).toEqual([{ tabId: 42 }]);
  });

  it("All tabs scope calls setOptions without tabId", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const fakeSidePanel = {
      setOptions: async (opts: Record<string, unknown>) => {
        calls.push(opts);
      },
    };
    await scopeAllTabs(fakeSidePanel);
    expect(calls).toHaveLength(1);
    expect("tabId" in calls[0]).toBe(false);
  });
});

describe("panel → SW → host JSON-RPC proxy", () => {
  it("proxies JSON-RPC to host with Bearer token, returns result", async () => {
    const fetched: Array<{ url: string; init: RequestInit }> = [];
    const fakeStorage = {
      get: async (keys: string[]) => {
        const out: Record<string, string> = {};
        for (const k of keys) {
          if (k === "hostToken") out.hostToken = "tok-abc";
          if (k === "hostPort") out.hostPort = "7420";
        }
        return out;
      },
    };
    const fakeFetch = async (url: string, init: RequestInit) => {
      fetched.push({ url, init });
      return {
        ok: true,
        json: async () => ({ jsonrpc: "2.0", id: "1", result: { ids: ["m1"] } }),
      } as Response;
    };
    const result = await handlePanelMessage(
      { type: "rpc", method: "models.list", params: {}, id: "1" },
      { storage: fakeStorage, fetch: fakeFetch },
    );
    expect(result).toEqual({ ids: ["m1"] });
    expect(fetched).toHaveLength(1);
    const [call] = fetched;
    expect(call.url).toMatch(/127\.0\.0\.1:7420/);
    const body = JSON.parse(String((call.init as { body: string }).body)) as Record<string, unknown>;
    expect(body.method).toBe("models.list");
    expect((call.init.headers as Record<string, string>)["authorization"]).toMatch(/^Bearer tok-abc/);
  });

  it("fromPage messages are not proxied", async () => {
    const fetched: unknown[] = [];
    const result = await handlePanelMessage(
      { type: "fromPage", method: "models.list" },
      { storage: { get: async () => ({}) }, fetch: async () => { fetched.push(1); return {} as Response; } },
    );
    expect(result).toEqual({ ignored: true });
    expect(fetched).toHaveLength(0);
  });
});

describe("sidepanel.html structure", () => {
  it("has a chat transcript element", () => {
    const html = readExt("sidepanel.html");
    expect(html).toMatch(/id="transcript"/);
  });

  it("has a composer textarea and send button", () => {
    const html = readExt("sidepanel.html");
    expect(html).toMatch(/id="compose"/);
    expect(html).toMatch(/id="send"/);
  });

  it("has a model select and stop button", () => {
    const html = readExt("sidepanel.html");
    expect(html).toMatch(/id="model"/);
    expect(html).toMatch(/id="stop"/);
  });

  it("has scope toggle buttons (This tab / All tabs)", () => {
    const html = readExt("sidepanel.html");
    expect(html).toMatch(/id="scope-tab"/);
    expect(html).toMatch(/id="scope-all"/);
  });
});
