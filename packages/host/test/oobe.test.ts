import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OriginAllowlist, emptySession, type LaunchOpts, type Launcher } from "@tyto/core";
import { FakeActuation, FakeModel, FakeOccupancy, FakePerception, MemorySessionStore } from "@tyto/core/testing";
import { TytoClient } from "@tyto/sdk";
import { bootLive, ensureHostToken, persistHostToken } from "../src/boot.ts";
import { composeFromEnv } from "../src/main.ts";
import { listen, type HostServer } from "../src/listen.ts";

const TOKEN = "oobetoken0123456789ab";

describe("out of the box host", () => {
  const servers: HostServer[] = [];
  afterEach(async () => {
    while (servers.length) await servers.pop()?.close();
  });

  it("GET / is Perch HTML and never embeds the host token", async () => {
    const server = await listen({
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      sessions: new MemorySessionStore(),
      allowlist: new OriginAllowlist(),
      navigation: { goto: async () => undefined, currentUrl: async () => new URL("about:blank") },
    });
    servers.push(server);
    const res = await fetch(server.url);
    const html = await res.text();
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(html).toContain("Send");
    expect(html).toContain("operator.grantOrigin");
    expect(html).toContain("session.run");
    expect(html).not.toContain(TOKEN);
    expect(html).not.toMatch(/Bearer /);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toContain("tyto_at=");
  });

  it("POST with the HttpOnly cookie authorizes session.list", async () => {
    const server = await listen({
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      sessions: new MemorySessionStore(),
      allowlist: new OriginAllowlist(),
      navigation: { goto: async () => undefined, currentUrl: async () => new URL("about:blank") },
    });
    servers.push(server);
    const res = await fetch(server.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `tyto_at=${TOKEN}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "session.list" }),
    });
    const body = (await res.json()) as { result?: unknown; error?: { message: string } };
    expect(body.error).toBeUndefined();
    expect(body.result).toEqual([]);
  });

  it("composeFromEnv wires a model and seeds TYTO_ALLOW", () => {
    const cfg = composeFromEnv({
      TYTO_HOST_TOKEN: TOKEN,
      TYTO_ALLOW: "https://example.com",
    });
    expect(cfg.models).toBeDefined();
    expect(cfg.observation).toBeDefined();
    expect(cfg.allowlist.permits(new URL("https://example.com/"))).toBe(true);
    expect(cfg.allowlist.permits(new URL("https://evil.test/"))).toBe(false);
  });

  it("ensureHostToken generates a local token when missing", () => {
    const a = ensureHostToken({});
    const b = ensureHostToken({ TYTO_HOST_TOKEN: TOKEN });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(TOKEN);
  });

  it("persistHostToken writes once and does not clobber", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tyto-env-"));
    const path = join(dir, ".env");
    await expect(persistHostToken(path, TOKEN)).resolves.toBe("written");
    await expect(persistHostToken(path, "n".repeat(32))).resolves.toBe("exists");
    const text = await readFile(path, "utf8");
    expect(text).toContain(`TYTO_HOST_TOKEN=${TOKEN}`);
    expect(text).not.toContain("n".repeat(32));
  });

  it("bootLive launches Chrome through the injected launcher", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tyto-profile-"));
    const launches: LaunchOpts[] = [];
    const launcher: Launcher = {
      async launch(opts) {
        launches.push(opts);
        return { disconnect: async () => undefined };
      },
    };
    const server = await bootLive(
      {
        TYTO_HOST_TOKEN: TOKEN,
        TYTO_PORT: "0",
        TYTO_PROFILE: dir,
        TYTO_DEBUG_PORT: "9333",
      },
      { launcher },
    );
    servers.push(server);
    expect(launches).toHaveLength(1);
    expect(launches[0]?.bindHost).toBe("127.0.0.1");
    expect(launches[0]?.userDataDir).toBe(dir);
    expect(launches[0]?.port).toBe(9333);
    const html = await (await fetch(server.url)).text();
    expect(html).toContain("Send");
    const client = new TytoClient({ url: server.url, token: TOKEN });
    await expect(client.call("session.list")).resolves.toEqual([]);
  });

  it("cookie JSON-RPC matches the Perch form: grant, goto, save, run", async () => {
    const navigation = {
      gotoCalls: 0,
      async goto(_url: URL) {
        this.gotoCalls += 1;
      },
      async currentUrl() {
        return new URL("about:blank");
      },
    };
    const perception = new FakePerception();
    perception.currentUrl = "https://example.com/";
    perception.seedUrl(
      "https://example.com/",
      [{ nodeId: "1", role: { value: "WebArea" }, name: { value: "Example Domain" } }],
      "Example Domain",
    );
    const model = new FakeModel();
    const server = await listen({
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      sessions: new MemorySessionStore(),
      allowlist: new OriginAllowlist(),
      navigation,
      perception,
      actuation: new FakeActuation(),
      occupancy: new FakeOccupancy(),
      models: model,
    });
    servers.push(server);
    const cookie = `tyto_at=${TOKEN}`;
    async function rpc(method: string, params: unknown): Promise<unknown> {
      const res = await fetch(server.url, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const body = (await res.json()) as { result?: unknown; error?: { message: string } };
      if (body.error) throw new Error(body.error.message);
      return body.result;
    }
    const session = { ...emptySession("ex-1", "extract the heading"), lastUrl: "https://example.com/", allowlist: ["https://example.com"] };
    await rpc("operator.grantOrigin", { origin: "https://example.com" });
    await rpc("page.goto", { url: "https://example.com/" });
    await rpc("session.save", { session });
    await expect(rpc("session.run", { id: "ex-1", frame: { tabId: "t", frameId: "main", origin: "https://example.com" } })).resolves.toEqual({
      ok: true,
    });
    expect(navigation.gotoCalls).toBe(1);
    expect(model.calls).toBe(1);
  });
});
