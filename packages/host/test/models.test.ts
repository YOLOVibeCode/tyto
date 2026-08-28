import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { emptySession, OriginAllowlist, type Navigation } from "@tyto/core";
import {
  FakeActuation,
  FakeModel,
  FakeOccupancy,
  FakePerception,
  MemorySessionStore,
} from "@tyto/core/testing";
import { TytoClient } from "@tyto/sdk";
import { listen, type HostServer, type ListenConfig } from "../src/index.ts";

const TOKEN = "t".repeat(32);
const NAV: Navigation = {
  goto: async () => undefined,
  currentUrl: async () => new URL("about:blank"),
};

function base(overrides: Partial<ListenConfig> = {}): ListenConfig {
  return {
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    sessions: new MemorySessionStore(),
    allowlist: new OriginAllowlist(),
    navigation: NAV,
    ...overrides,
  };
}

describe("models.list from host catalog", () => {
  const servers: HostServer[] = [];
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (servers.length) await servers.pop()?.close();
    while (closers.length) await closers.pop()?.();
  });

  async function boot(overrides: Partial<ListenConfig> = {}): Promise<HostServer> {
    const server = await listen(base(overrides));
    servers.push(server);
    return server;
  }

  function modelServer(ids: string[]): Promise<{ url: URL; close: () => Promise<void> }> {
    const srv = createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: ids.map((id) => ({ id })) }));
    });
    return new Promise((resolve, reject) => {
      srv.once("error", reject);
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address();
        if (!addr || typeof addr === "string") {
          reject(new Error("listen failed"));
          return;
        }
        resolve({
          url: new URL(`http://127.0.0.1:${addr.port}/v1`),
          close: () =>
            new Promise<void>((res, rej) => {
              srv.close((e) => (e ? rej(e) : res()));
              srv.closeAllConnections();
            }),
        });
      });
    });
  }

  it("models.list with no params uses host catalog (TYTO_BASE_URL)", async () => {
    const ms = await modelServer(["ollama3", "mistral"]);
    closers.push(ms.close);
    const { OpenAiCatalog } = await import("@tyto/llm");
    const server = await boot({
      catalog: new OpenAiCatalog(),
      modelBaseUrl: ms.url,
      modelApiKey: "",
    });
    const client = new TytoClient({ url: server.url, token: TOKEN });
    const result = (await client.call("models.list")) as { ids: string[] };
    expect(result.ids).toContain("ollama3");
    expect(result.ids).toContain("mistral");
  });

  it("models.list ignores client-supplied baseUrl when host catalog present", async () => {
    const ms = await modelServer(["host-model"]);
    closers.push(ms.close);
    const { OpenAiCatalog } = await import("@tyto/llm");
    const server = await boot({
      catalog: new OpenAiCatalog(),
      modelBaseUrl: ms.url,
      modelApiKey: "",
    });
    const client = new TytoClient({ url: server.url, token: TOKEN });
    const result = (await client.call("models.list", { baseUrl: "https://api.openai.com/v1" })) as {
      ids: string[];
    };
    expect(result.ids).toContain("host-model");
  });

  it("session.run uses session.model.id when set", async () => {
    const perception = new FakePerception();
    const actuation = new FakeActuation();
    const occupancy = new FakeOccupancy();
    perception.currentUrl = "https://example.com/";
    perception.seedUrl(
      "https://example.com/",
      [{ nodeId: "1", role: { value: "WebArea" }, name: { value: "Example" } }],
      "Example",
    );
    const usedIds: string[] = [];
    const resolver = (id: string): import("@tyto/core").ModelPort => ({
      async complete(req) {
        usedIds.push(id);
        return {
          text: JSON.stringify({
            rationale: "ok",
            anchors: [],
            steps: [{ op: "done", reason: "ok" }],
          }),
        };
      },
    });
    const server = await boot({
      perception,
      actuation,
      occupancy,
      modelResolver: resolver,
    });
    const sessions = new MemorySessionStore();
    const client = new TytoClient({ url: server.url, token: TOKEN });
    await client.call("session.save", {
      session: {
        ...emptySession("m1", "test"),
        lastUrl: "https://example.com/",
        allowlist: ["https://example.com"],
        model: { id: "picked-model", baseUrl: "" },
      },
    });
    await client.call("session.run", {
      id: "m1",
      frame: { tabId: "t", frameId: "main", origin: "https://example.com" },
    });
    expect(usedIds).toEqual(["picked-model"]);
  });

  it("session.run falls back to ports.models when session.model.id is empty", async () => {
    const perception = new FakePerception();
    const actuation = new FakeActuation();
    const occupancy = new FakeOccupancy();
    const fallback = new FakeModel();
    perception.currentUrl = "https://example.com/";
    perception.seedUrl(
      "https://example.com/",
      [{ nodeId: "1", role: { value: "WebArea" }, name: { value: "Example" } }],
      "Example",
    );
    const server = await boot({
      perception,
      actuation,
      occupancy,
      models: fallback,
    });
    const client = new TytoClient({ url: server.url, token: TOKEN });
    await client.call("session.save", {
      session: {
        ...emptySession("m2", "test"),
        lastUrl: "https://example.com/",
        allowlist: ["https://example.com"],
        model: { id: "", baseUrl: "" },
      },
    });
    await client.call("session.run", {
      id: "m2",
      frame: { tabId: "t", frameId: "main", origin: "https://example.com" },
    });
    expect(fallback.calls).toBe(1);
  });
});
