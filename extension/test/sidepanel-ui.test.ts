// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PANEL_JS = readFileSync(join(ROOT, "sidepanel.js"), "utf8");
const PANEL_HTML = readFileSync(join(ROOT, "sidepanel.html"), "utf8");

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function bodyHtml(html: string): string {
  const m = html.match(/<body>([\s\S]*?)<\/body>/i);
  return m?.[1] ?? "";
}

type SentMessage = { type: string; method?: string; params?: unknown; tabId?: number };

interface FakeChrome {
  sentMessages: SentMessage[];
  storageLocal: Record<string, unknown>;
  activeTabId: number;
  activeTabUrl: string;
  rpcHandler: (method: string, params: unknown) => unknown;
}

/**
 * Mount the sidepanel DOM + stub the chrome global, then evaluate sidepanel.js.
 * The `rpcHandler` is used to answer RPC messages (type: "rpc").
 */
function mountPanel(opts: Partial<FakeChrome> = {}): FakeChrome {
  const state: FakeChrome = {
    sentMessages: [],
    storageLocal: {},
    activeTabId: 42,
    activeTabUrl: "https://example.com/",
    rpcHandler: (method) => {
      if (method === "models.list") return { ids: ["llama3:8b"] };
      return { ok: true };
    },
    ...opts,
  };

  document.body.innerHTML = bodyHtml(PANEL_HTML);

  // Build fake chrome global
  const chrome = {
    runtime: {
      lastError: null as string | null,
      sendMessage: (
        msg: SentMessage,
        callback?: (resp: { ok: boolean; result?: unknown; error?: string }) => void,
      ) => {
        state.sentMessages.push(msg);
        if (!callback) return;
        if (msg.type === "rpc") {
          try {
            const result = state.rpcHandler(msg.method ?? "", msg.params ?? {});
            callback({ ok: true, result });
          } catch (e) {
            callback({ ok: false, error: String(e) });
          }
        } else {
          callback({ ok: true });
        }
      },
    },
    storage: {
      local: {
        get: (_keys: string[], cb: (r: Record<string, unknown>) => void) => {
          cb(state.storageLocal);
        },
        set: (items: Record<string, unknown>) => {
          Object.assign(state.storageLocal, items);
        },
      },
      session: {
        get: (_keys: string[], cb: (r: Record<string, unknown>) => void) => cb({}),
        set: () => {},
      },
    },
    tabs: {
      query: (_q: unknown, cb: (tabs: Array<{ id: number; url: string }>) => void) => {
        cb([{ id: state.activeTabId, url: state.activeTabUrl }]);
      },
    },
  };

  vi.stubGlobal("chrome", chrome);
  vi.stubGlobal("crypto", { randomUUID: () => "panel-uuid" });

  // eval the sidepanel script (runs loadModels() immediately)
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  (0, eval)(PANEL_JS);

  return state;
}

describe("sidepanel.js — model picker", () => {
  it("loads models via RPC message (not direct fetch) on mount", async () => {
    const state = mountPanel();
    await flushPromises();
    const rpcMsgs = state.sentMessages.filter((m) => m.type === "rpc" && m.method === "models.list");
    expect(rpcMsgs.length).toBeGreaterThanOrEqual(1);
    const sel = document.getElementById("model") as HTMLSelectElement;
    expect(sel.options.length).toBe(1);
    expect(sel.options[0]?.value).toBe("llama3:8b");
  });

  it("shows unavailable and status message when models.list fails", async () => {
    mountPanel({
      rpcHandler: () => {
        throw new Error("host down");
      },
    });
    await flushPromises();
    const sel = document.getElementById("model") as HTMLSelectElement;
    expect(sel.innerHTML).toContain("unavailable");
    expect(document.getElementById("status")?.textContent).toMatch(/models\.list failed/);
  });

  it("restores persisted model selection from storage.local", async () => {
    mountPanel({
      storageLocal: { lastModel: "llama3:8b" },
      rpcHandler: (method) => {
        if (method === "models.list") return { ids: ["llama3:8b", "mistral:7b"] };
        return { ok: true };
      },
    });
    await flushPromises();
    const sel = document.getElementById("model") as HTMLSelectElement;
    expect(sel.value).toBe("llama3:8b");
  });

  it("persists model change to storage.local on select change", async () => {
    const state = mountPanel({
      rpcHandler: (method) => {
        if (method === "models.list") return { ids: ["llama3:8b", "mistral:7b"] };
        return { ok: true };
      },
    });
    await flushPromises();
    const sel = document.getElementById("model") as HTMLSelectElement;
    sel.value = "mistral:7b";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(state.storageLocal.lastModel).toBe("mistral:7b");
  });
});

describe("sidepanel.js — scope toggle", () => {
  it("This tab sends scope:tab with active tabId; persists to storage.local", async () => {
    const state = mountPanel();
    await flushPromises();
    state.sentMessages.length = 0; // clear init messages

    document.getElementById("scope-tab")!.click();
    await flushPromises();

    const scopeMsg = state.sentMessages.find((m) => m.type === "scope:tab");
    expect(scopeMsg).toBeDefined();
    expect(scopeMsg?.tabId).toBe(42);
    expect(state.storageLocal.scope).toBe("tab");
  });

  it("All tabs sends scope:all without tabId; persists to storage.local", async () => {
    const state = mountPanel();
    await flushPromises();
    state.sentMessages.length = 0;

    document.getElementById("scope-all")!.click();
    await flushPromises();

    const scopeMsg = state.sentMessages.find((m) => m.type === "scope:all");
    expect(scopeMsg).toBeDefined();
    expect("tabId" in (scopeMsg ?? {})).toBe(false);
    expect(state.storageLocal.scope).toBe("all");
  });

  it("restores persisted scope=all from storage on init", async () => {
    mountPanel({ storageLocal: { scope: "all" } });
    await flushPromises();
    expect(document.getElementById("scope-all")?.classList.contains("active")).toBe(true);
    expect(document.getElementById("scope-tab")?.classList.contains("active")).toBe(false);
  });
});

describe("sidepanel.js — Send", () => {
  it("first send creates session via RPC and appends user bubble", async () => {
    const state = mountPanel({
      rpcHandler: (method) => {
        if (method === "models.list") return { ids: ["llama3:8b"] };
        if (method === "session.open")
          return {
            id: "panel-uuid",
            goal: "hello",
            messages: [{ role: "user", content: "hello" }],
            plan: null, recipes: [], answers: [], lastUrl: null,
            allowlist: [], model: { id: "", baseUrl: "" },
            vaultHandles: {}, remainingSteps: [],
          };
        return { ok: true };
      },
    });
    await flushPromises();
    state.sentMessages.length = 0;

    const compose = document.getElementById("compose") as HTMLTextAreaElement;
    compose.value = "hello";
    document.getElementById("send")!.click();
    await flushPromises();

    const saveMsgs = state.sentMessages.filter(
      (m) => m.type === "rpc" && m.method === "session.save",
    );
    const runMsgs = state.sentMessages.filter(
      (m) => m.type === "rpc" && m.method === "session.run",
    );
    expect(saveMsgs.length).toBeGreaterThanOrEqual(1);
    expect(runMsgs.length).toBeGreaterThanOrEqual(1);

    const transcript = document.getElementById("transcript")!;
    const bubbles = transcript.querySelectorAll(".bubble");
    expect(Array.from(bubbles).some((b) => b.textContent === "hello")).toBe(true);
  });

  it("grants only focused tab's origin — not every origin visited", async () => {
    const state = mountPanel({
      activeTabUrl: "https://example.com/page",
      rpcHandler: (method) => {
        if (method === "models.list") return { ids: [] };
        if (method === "session.open")
          return {
            id: "panel-uuid", goal: "t", messages: [], plan: null,
            recipes: [], answers: [], lastUrl: null, allowlist: [],
            model: { id: "", baseUrl: "" }, vaultHandles: {}, remainingSteps: [],
          };
        return { ok: true };
      },
    });
    await flushPromises();
    state.sentMessages.length = 0;

    const compose = document.getElementById("compose") as HTMLTextAreaElement;
    compose.value = "test goal";
    document.getElementById("send")!.click();
    await flushPromises();

    const grantMsgs = state.sentMessages.filter(
      (m) => m.type === "rpc" && m.method === "operator.grantOrigin",
    );
    // Exactly one grantOrigin, for the focused tab's origin
    expect(grantMsgs.length).toBe(1);
    const grantedOrigin = (grantMsgs[0]?.params as { origin: string })?.origin;
    expect(grantedOrigin).toBe("https://example.com");
  });

  it("host-down error surfaces in status without crash", async () => {
    mountPanel({
      rpcHandler: (method) => {
        if (method === "models.list") return { ids: [] };
        throw new Error("connection refused");
      },
    });
    await flushPromises();

    const compose = document.getElementById("compose") as HTMLTextAreaElement;
    compose.value = "test";
    document.getElementById("send")!.click();
    await flushPromises();

    const status = document.getElementById("status")!;
    expect(status.textContent).toMatch(/connection refused/);
  });

  it("Enter key sends; Shift+Enter inserts newline (no send)", async () => {
    const state = mountPanel({
      rpcHandler: (method) => {
        if (method === "models.list") return { ids: [] };
        if (method === "session.open")
          return {
            id: "panel-uuid", goal: "t", messages: [], plan: null,
            recipes: [], answers: [], lastUrl: null, allowlist: [],
            model: { id: "", baseUrl: "" }, vaultHandles: {}, remainingSteps: [],
          };
        return { ok: true };
      },
    });
    await flushPromises();
    state.sentMessages.length = 0;

    const compose = document.getElementById("compose") as HTMLTextAreaElement;
    compose.value = "msg";

    // Shift+Enter must NOT send
    compose.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }),
    );
    await flushPromises();
    expect(state.sentMessages.filter((m) => m.type === "rpc" && m.method === "session.save").length).toBe(0);

    // Plain Enter MUST send
    compose.value = "msg";
    compose.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", shiftKey: false, bubbles: true }),
    );
    await flushPromises();
    expect(state.sentMessages.some((m) => m.type === "rpc" && m.method === "session.save")).toBe(true);
  });
});

describe("sidepanel.js — Stop", () => {
  it("Stop button calls operator.interrupt and shows stopped", async () => {
    const state = mountPanel();
    await flushPromises();
    state.sentMessages.length = 0;

    document.getElementById("stop")!.click();
    await flushPromises();

    expect(
      state.sentMessages.some((m) => m.type === "rpc" && m.method === "operator.interrupt"),
    ).toBe(true);
    expect(document.getElementById("status")?.textContent).toBe("stopped");
  });
});
