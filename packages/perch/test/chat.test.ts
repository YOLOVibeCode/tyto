import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, afterEach } from "vitest";
import { emptySession, OriginAllowlist, type Navigation } from "@tyto/core";
import {
  FakeActuation,
  FakeModel,
  FakeOccupancy,
  FakePerception,
  MemorySessionStore,
} from "@tyto/core/testing";
import { listen, type HostServer, type ListenConfig } from "@tyto/host";
import { TytoClient } from "@tyto/sdk";
import { PerchController } from "../src/index.ts";

const TOKEN = "t".repeat(32);
const PERCH_HTML = readFileSync(
  join(fileURLToPath(new URL("../../host/src", import.meta.url)), "perch.html"),
  "utf8",
);

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
    occupancy: new FakeOccupancy(),
    perception: new FakePerception(),
    actuation: new FakeActuation(),
    models: new FakeModel(),
    ...overrides,
  };
}

describe("PerchController chat extensions", () => {
  const servers: HostServer[] = [];
  afterEach(async () => {
    while (servers.length) await servers.pop()?.close();
  });

  async function boot(overrides: Partial<ListenConfig> = {}): Promise<HostServer> {
    const server = await listen(base(overrides));
    servers.push(server);
    return server;
  }

  it("setModel writes session.model.id then session.run uses that id", async () => {
    const usedIds: string[] = [];
    const resolver = (id: string): import("@tyto/core").ModelPort => ({
      async complete() {
        usedIds.push(id);
        return {
          text: JSON.stringify({ rationale: "ok", anchors: [], steps: [{ op: "done", reason: "ok" }] }),
        };
      },
    });
    const perception = new FakePerception();
    perception.currentUrl = "https://example.com/";
    perception.seedUrl("https://example.com/", [
      { nodeId: "1", role: { value: "WebArea" }, name: { value: "Example" } },
    ], "Example");
    const server = await boot({ perception, modelResolver: resolver });
    const client = new TytoClient({ url: server.url, token: TOKEN });
    await client.call("session.save", {
      session: {
        ...emptySession("s1", "test"),
        lastUrl: "https://example.com/",
        allowlist: ["https://example.com"],
      },
    });
    const perch = new PerchController({ client });
    await perch.setModel("s1", "my-model");
    await perch.send("s1", { tabId: "t", frameId: "main", origin: "https://example.com" });
    expect(usedIds).toEqual(["my-model"]);
  });

  it("setModel saves session with model.id and returns updated session", async () => {
    const sessions = new MemorySessionStore();
    const server = await boot({ sessions });
    const client = new TytoClient({ url: server.url, token: TOKEN });
    await client.call("session.save", {
      session: emptySession("s2", "pick a model"),
    });
    const perch = new PerchController({ client });
    await perch.setModel("s2", "ollama3");
    const opened = (await client.call("session.open", { id: "s2" })) as { model: { id: string } };
    expect(opened.model.id).toBe("ollama3");
  });

  it("send appends a user message and runs the session", async () => {
    const model = new FakeModel();
    const perception = new FakePerception();
    perception.currentUrl = "https://example.com/";
    perception.seedUrl("https://example.com/", [
      { nodeId: "1", role: { value: "WebArea" }, name: { value: "Example" } },
    ], "Example");
    const server = await boot({ models: model, perception });
    const client = new TytoClient({ url: server.url, token: TOKEN });
    await client.call("session.save", {
      session: {
        ...emptySession("s3", "initial goal"),
        lastUrl: "https://example.com/",
        allowlist: ["https://example.com"],
      },
    });
    const perch = new PerchController({ client });
    await perch.send("s3", { tabId: "t", frameId: "main", origin: "https://example.com" });
    expect(model.calls).toBe(1);
  });

  it("dispose does not delete the session", async () => {
    const sessions = new MemorySessionStore();
    const server = await boot({ sessions });
    const client = new TytoClient({ url: server.url, token: TOKEN });
    await client.call("session.save", { session: emptySession("keep2", "stay alive") });
    const perch = new PerchController({ client });
    perch.dispose();
    const opened = (await client.call("session.open", { id: "keep2" })) as { goal: string };
    expect(opened.goal).toBe("stay alive");
  });
});

describe("perch.html composer + model picker", () => {
  it("has a model <select> element", () => {
    expect(PERCH_HTML).toMatch(/<select[^>]*id="model"/);
  });

  it("has a chat transcript container", () => {
    expect(PERCH_HTML).toMatch(/id="transcript"/);
  });

  it("has a send/compose button and textarea", () => {
    expect(PERCH_HTML).toMatch(/id="compose"/);
    expect(PERCH_HTML).toMatch(/id="send"/);
  });

  it("has a stop button", () => {
    expect(PERCH_HTML).toMatch(/id="stop"/);
  });

  it("token is not in the HTML body", () => {
    expect(PERCH_HTML).not.toMatch(/tyto_at/);
    expect(PERCH_HTML).not.toMatch(/TYTO_HOST_TOKEN/);
  });

  it("populates model dropdown from models.list on load", () => {
    expect(PERCH_HTML).toMatch(/models\.list/);
  });
});
