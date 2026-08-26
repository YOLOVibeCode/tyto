import { describe, expect, it } from "vitest";
import { emptySession, parseSession, serializeSession } from "../src/session/schema.ts";
import { MemorySessionStore } from "../src/testing/fakes.ts";

describe("session document", () => {
  it("saves goal, messages, plan, recipes, lastUrl, allowlist", async () => {
    const store = new MemorySessionStore();
    const s = emptySession("s1", "extract barn owl status");
    s.lastUrl = "https://en.wikipedia.org/wiki/Barn_owl";
    s.allowlist = ["https://en.wikipedia.org"];
    s.recipes = [{ role: "link", name: "Barn owl", origin: "https://en.wikipedia.org" }];
    s.plan = { rationale: "search", anchors: [], steps: [{ op: "done", reason: "ok" }] };
    s.model = { id: "gpt-oss:20b", baseUrl: "http://127.0.0.1:11434/v1" };
    await store.save(s);
    const loaded = await store.load("s1");
    expect(loaded?.goal).toBe(s.goal);
    expect(loaded?.lastUrl).toContain("Barn_owl");
    expect(loaded?.allowlist).toEqual(["https://en.wikipedia.org"]);
    expect(loaded?.recipes[0]?.name).toBe("Barn owl");
    expect(loaded?.model.id).toBe("gpt-oss:20b");
  });

  it("roundtrip drops ref_N, backendNodeId, box, screenshot if present in input", () => {
    const dirty = JSON.stringify({
      id: "s1",
      goal: "x",
      backendNodeId: 99,
      ref_N: "ref_1",
      box: { x: 1 },
      screenshot: "data:image/png;base64,aaa",
      apiKey: "sk-live-should-not-survive",
      recipes: [{ role: "button", name: "Go", origin: "https://example.com", backendNodeId: 12 }],
    });
    const s = parseSession(dirty);
    const raw = serializeSession(s);
    expect(raw).not.toContain("backendNodeId");
    expect(raw).not.toContain("screenshot");
    expect(raw).not.toContain("sk-live");
    expect(raw).not.toContain("apiKey");
  });

  it("load missing id returns null", async () => {
    expect(await new MemorySessionStore().load("nope")).toBeNull();
  });

  it("resume payload includes lastUrl and remaining plan steps", async () => {
    const store = new MemorySessionStore();
    const s = emptySession("s1", "goal");
    s.lastUrl = "https://example.com/invoice";
    s.remainingSteps = [{ op: "click", role: "button", name: "Download" }];
    await store.save(s);
    const loaded = await store.load("s1");
    expect(loaded?.lastUrl).toBe("https://example.com/invoice");
    expect(loaded?.remainingSteps[0]).toMatchObject({ op: "click", name: "Download" });
  });

  it("model settings persist id + baseUrl and never persist raw apiKey", async () => {
    const store = new MemorySessionStore();
    const s = emptySession("s1", "g");
    s.model = { id: "qwen", baseUrl: "http://127.0.0.1:11434/v1" };
    await store.save(s);
    const raw = store.raw("s1")!;
    expect(raw).toContain("qwen");
    expect(raw).not.toMatch(/apiKey/);
    expect(JSON.parse(raw).model.apiKey).toBeUndefined();
  });

  it("session JSON after capture contains vault handle, not a cookie value", async () => {
    const store = new MemorySessionStore();
    const s = emptySession("s1", "g");
    s.vaultHandles = { "https://hr.example.edu": "vault_abc" };
    await store.save(s);
    const raw = store.raw("s1")!;
    expect(raw).toContain("vault_abc");
    expect(raw).not.toMatch(/sessionid=/i);
    expect(raw).not.toMatch(/Set-Cookie/i);
  });
});
