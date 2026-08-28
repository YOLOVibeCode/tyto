// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../src");
const PERCH_HTML = readFileSync(join(SRC, "perch.html"), "utf8");

/** Drain the microtask + promise queue. */
function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Extract the body HTML content (between <body> tags). */
function bodyHtml(html: string): string {
  const m = html.match(/<body>([\s\S]*?)<\/body>/i);
  return m?.[1] ?? "";
}

/** Extract the first inline <script> content. */
function inlineScript(html: string): string {
  const m = html.match(/<script>([\s\S]*?)<\/script>/i);
  return m?.[1] ?? "";
}

type Call = { method: string; params: unknown };

/** Build a scripted fetch that records calls and returns canned responses. */
function buildFetch(handler: (method: string, params: unknown) => unknown) {
  return async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      method: string;
      params: unknown;
      id: string;
    };
    const result = handler(body.method, body.params);
    return {
      ok: true,
      json: async () => ({ jsonrpc: "2.0", id: body.id, result }),
    } as Response;
  };
}

/** Mount the perch DOM and run the inline script with a given fetch stub. */
async function mountPerch(handler: (method: string, params: unknown) => unknown) {
  document.body.innerHTML = bodyHtml(PERCH_HTML);
  const script = inlineScript(PERCH_HTML);
  // Patch global fetch before script runs (loadModels fires immediately)
  vi.stubGlobal("fetch", buildFetch(handler));
  // Patch crypto.randomUUID so sessions get stable ids in test
  vi.stubGlobal("crypto", {
    randomUUID: () => "test-uuid",
  });
  // eslint-disable-next-line no-eval
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  (0, eval)(script);
  // Let loadModels() complete
  await flushPromises();
}

describe("perch.html — model picker", () => {
  it("populates model dropdown from models.list on load", async () => {
    const calls: Call[] = [];
    await mountPerch((method, params) => {
      calls.push({ method, params });
      if (method === "models.list") return { ids: ["llama3:8b", "mistral:7b"] };
      return {};
    });
    const sel = document.getElementById("model") as HTMLSelectElement;
    expect(sel.options.length).toBe(2);
    expect(sel.options[0]?.value).toBe("llama3:8b");
    expect(sel.options[1]?.value).toBe("mistral:7b");
    expect(calls.some((c) => c.method === "models.list")).toBe(true);
  });

  it("shows unavailable when models.list fails", async () => {
    await mountPerch((method) => {
      if (method === "models.list") throw new Error("offline");
      return {};
    });
    const sel = document.getElementById("model") as HTMLSelectElement;
    expect(sel.innerHTML).toContain("unavailable");
    const status = document.getElementById("status");
    expect(status?.textContent).toMatch(/models\.list failed/);
  });

  it("shows no models option when list is empty", async () => {
    await mountPerch((method) => {
      if (method === "models.list") return { ids: [] };
      return {};
    });
    const sel = document.getElementById("model") as HTMLSelectElement;
    expect(sel.innerHTML).toContain("no models");
  });
});

describe("perch.html — Go bar (URL navigation flow)", () => {
  it("calls grantOrigin → page.goto → session.save → session.run in order", async () => {
    const calls: Call[] = [];
    await mountPerch((method, params) => {
      calls.push({ method, params });
      if (method === "models.list") return { ids: ["llama3:8b"] };
      return { ok: true };
    });

    const urlInput = document.getElementById("url") as HTMLInputElement;
    const runBtn = document.getElementById("run") as HTMLButtonElement;
    urlInput.value = "https://example.com/";
    runBtn.click();
    await flushPromises();

    const rpcCalls = calls.filter((c) => c.method !== "models.list");
    expect(rpcCalls.map((c) => c.method)).toEqual([
      "operator.grantOrigin",
      "page.goto",
      "session.save",
      "session.run",
    ]);
    const saveCall = rpcCalls.find((c) => c.method === "session.save");
    const session = (saveCall?.params as { session: { lastUrl: string; allowlist: string[] } })
      ?.session;
    expect(session?.lastUrl).toBe("https://example.com/");
    expect(session?.allowlist).toContain("https://example.com");
  });

  it("includes selected model id in session.save", async () => {
    const calls: Call[] = [];
    await mountPerch((method, params) => {
      calls.push({ method, params });
      if (method === "models.list") return { ids: ["mistral:7b", "llama3:8b"] };
      return { ok: true };
    });
    // Select second model
    const sel = document.getElementById("model") as HTMLSelectElement;
    sel.value = "llama3:8b";

    const urlInput = document.getElementById("url") as HTMLInputElement;
    urlInput.value = "https://example.com/";
    document.getElementById("run")!.click();
    await flushPromises();

    const saveCall = calls.find((c) => c.method === "session.save");
    const model = (saveCall?.params as { session: { model: { id: string } } })?.session?.model;
    expect(model?.id).toBe("llama3:8b");
  });

  it("shows error in status when URL is empty", async () => {
    await mountPerch(() => ({ ids: ["llama3:8b"] }));
    const urlInput = document.getElementById("url") as HTMLInputElement;
    urlInput.value = "";
    document.getElementById("run")!.click();
    await flushPromises();
    expect(document.getElementById("status")?.textContent).toMatch(/URL/i);
  });

  it("shows error when URL is invalid", async () => {
    await mountPerch(() => ({ ids: ["llama3:8b"] }));
    const urlInput = document.getElementById("url") as HTMLInputElement;
    urlInput.value = "not-a-url";
    document.getElementById("run")!.click();
    await flushPromises();
    expect(document.getElementById("status")?.textContent).toMatch(/invalid/i);
  });
});

describe("perch.html — Send (composer)", () => {
  it("creates new session on first send and appends user bubble", async () => {
    const calls: Call[] = [];
    await mountPerch((method, params) => {
      calls.push({ method, params });
      if (method === "models.list") return { ids: ["llama3:8b"] };
      if (method === "session.open")
        return {
          id: "test-uuid",
          goal: "hello",
          messages: [
            { role: "user", content: "hello" },
            { role: "assistant", content: "Hi there!" },
          ],
          plan: null,
          recipes: [],
          answers: [],
          lastUrl: null,
          allowlist: [],
          model: { id: "", baseUrl: "" },
          vaultHandles: {},
          remainingSteps: [],
        };
      return { ok: true };
    });

    const compose = document.getElementById("compose") as HTMLTextAreaElement;
    compose.value = "hello";
    document.getElementById("send")!.click();
    await flushPromises();

    const transcript = document.getElementById("transcript")!;
    const bubbles = transcript.querySelectorAll(".bubble");
    expect(bubbles.length).toBeGreaterThanOrEqual(1);
    expect(bubbles[0]?.textContent).toBe("hello");
    const saveCall = calls.find((c) => c.method === "session.save");
    expect(saveCall).toBeDefined();
    expect(calls.some((c) => c.method === "session.run")).toBe(true);
  });

  it("appends assistant reply bubble after session.run completes", async () => {
    await mountPerch((method) => {
      if (method === "models.list") return { ids: ["llama3:8b"] };
      if (method === "session.open")
        return {
          id: "test-uuid",
          goal: "hello",
          messages: [
            { role: "user", content: "hello" },
            { role: "assistant", content: "Assistant reply" },
          ],
          plan: null,
          recipes: [],
          answers: [],
          lastUrl: null,
          allowlist: [],
          model: { id: "", baseUrl: "" },
          vaultHandles: {},
          remainingSteps: [],
        };
      return { ok: true };
    });
    const compose = document.getElementById("compose") as HTMLTextAreaElement;
    compose.value = "hello";
    document.getElementById("send")!.click();
    await flushPromises();
    const bubbles = document.getElementById("transcript")!.querySelectorAll(".bubble");
    const texts = Array.from(bubbles).map((b) => b.textContent);
    expect(texts).toContain("Assistant reply");
  });

  it("multi-turn: second send opens session, appends message, reuses session id", async () => {
    const calls: Call[] = [];
    let messageCount = 0;
    await mountPerch((method, params) => {
      calls.push({ method, params });
      if (method === "models.list") return { ids: ["llama3:8b"] };
      if (method === "session.open") {
        messageCount++;
        return {
          id: "test-uuid",
          goal: "first",
          messages: [{ role: "user", content: "first" }],
          plan: null,
          recipes: [],
          answers: [],
          lastUrl: null,
          allowlist: [],
          model: { id: "", baseUrl: "" },
          vaultHandles: {},
          remainingSteps: [],
        };
      }
      return { ok: true };
    });

    // First send
    const compose = document.getElementById("compose") as HTMLTextAreaElement;
    compose.value = "first";
    document.getElementById("send")!.click();
    await flushPromises();

    // Second send (session already set)
    compose.value = "second";
    document.getElementById("send")!.click();
    await flushPromises();

    // Second send should call session.open (to append), then session.save, then session.run
    const sessionOpenCalls = calls.filter((c) => c.method === "session.open");
    expect(sessionOpenCalls.length).toBeGreaterThanOrEqual(1);
    const sessionRunCalls = calls.filter((c) => c.method === "session.run");
    expect(sessionRunCalls.length).toBe(2);
    // All runs use the same session id
    const ids = sessionRunCalls.map(
      (c) => (c.params as { id: string })?.id,
    );
    expect(ids[0]).toBe(ids[1]);
  });

  it("Enter key triggers send; Shift+Enter does not", async () => {
    const calls: Call[] = [];
    await mountPerch((method, params) => {
      calls.push({ method, params });
      if (method === "models.list") return { ids: [] };
      return { ok: true };
    });

    const compose = document.getElementById("compose") as HTMLTextAreaElement;
    compose.value = "test-enter";

    // Shift+Enter should NOT send
    compose.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
    await flushPromises();
    expect(calls.filter((c) => c.method === "session.save").length).toBe(0);

    // Plain Enter should send
    compose.value = "test-enter";
    compose.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: false, bubbles: true }));
    await flushPromises();
    expect(calls.some((c) => c.method === "session.save")).toBe(true);
  });
});

describe("perch.html — Stop", () => {
  it("Stop button calls operator.interrupt", async () => {
    const calls: Call[] = [];
    await mountPerch((method, params) => {
      calls.push({ method, params });
      if (method === "models.list") return { ids: [] };
      return { ok: true };
    });
    document.getElementById("stop")!.click();
    await flushPromises();
    expect(calls.some((c) => c.method === "operator.interrupt")).toBe(true);
    expect(document.getElementById("status")?.textContent).toBe("stopped");
  });
});
