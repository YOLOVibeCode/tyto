import { request as httpRequest } from "node:http";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OriginAllowlist } from "@tyto/core";
import { MemorySessionStore } from "@tyto/core/testing";
import { POWER_METHODS, RPC_ERROR } from "@tyto/protocol";
import { RpcError, TytoClient } from "@tyto/sdk";
import { listen, type HostServer, type ListenConfig } from "../src/listen.ts";
import { readHostState, writeHostState } from "../src/state.ts";

const POWER = "p".repeat(32);
const SAFE = "s".repeat(32);

function config(overrides: Partial<ListenConfig> = {}): ListenConfig {
  return {
    bind: "127.0.0.1",
    port: 0,
    token: POWER,
    safeToken: SAFE,
    sessions: new MemorySessionStore(),
    allowlist: new OriginAllowlist(),
    navigation: { goto: async () => undefined, currentUrl: async () => new URL("about:blank") },
    ...overrides,
  };
}

type RawResponse = { status: number; headers: Record<string, string | string[] | undefined>; body: string };

function raw(
  server: HostServer,
  opts: { method?: string; path?: string; headers?: Record<string, string>; body?: string; endBody?: boolean },
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: server.port,
        method: opts.method ?? "GET",
        path: opts.path ?? "/",
        headers: opts.headers ?? {},
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => {
          body += c;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    if (opts.endBody !== false) req.end();
  });
}

function rpcBody(method: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id: 1, method });
}

describe("host hardening and token scopes", () => {
  const servers: HostServer[] = [];
  afterEach(async () => {
    while (servers.length) await servers.pop()?.close();
  });

  async function boot(overrides: Partial<ListenConfig> = {}): Promise<HostServer> {
    const server = await listen(config(overrides));
    servers.push(server);
    return server;
  }

  it("GET / never returns a token in Set-Cookie or body to an unauthenticated request", async () => {
    const server = await boot();
    const res = await raw(server, {});
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(res.body).not.toContain(SAFE);
    expect(res.body).not.toContain(POWER);
  });

  it("a one-time Perch link sets the safe token cookie, never the power token, then redirects to /", async () => {
    const server = await boot();
    const link = new URL(server.perchLink());
    const res = await raw(server, { path: `${link.pathname}${link.search}` });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("/");
    const cookie = String(res.headers["set-cookie"] ?? "");
    expect(cookie).toContain(`tyto_at=${SAFE}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).not.toContain(POWER);
  });

  it("a Perch link cannot be reused", async () => {
    const server = await boot();
    const link = new URL(server.perchLink());
    await raw(server, { path: `${link.pathname}${link.search}` });
    const again = await raw(server, { path: `${link.pathname}${link.search}` });
    expect(again.headers["set-cookie"]).toBeUndefined();
  });

  it("a HEAD request does not consume a Perch link", async () => {
    const server = await boot();
    const link = new URL(server.perchLink());
    await raw(server, { method: "HEAD", path: `${link.pathname}${link.search}` });
    const get = await raw(server, { path: `${link.pathname}${link.search}` });
    expect(String(get.headers["set-cookie"] ?? "")).toContain(`tyto_at=${SAFE}`);
  });

  it("safe token calling a POWER_METHODS method → unauthorized", async () => {
    const server = await boot();
    const method = POWER_METHODS[0];
    const client = new TytoClient({ url: server.url, token: SAFE });
    const err = await client.call(method).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).code).toBe(RPC_ERROR.UNAUTHORIZED);
  });

  it("safe cookie calling a POWER_METHODS method → unauthorized", async () => {
    const server = await boot();
    const res = await raw(server, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `tyto_at=${SAFE}` },
      body: rpcBody(POWER_METHODS[0]),
    });
    expect(res.status).toBe(401);
  });

  it("safe token may call Perch-safe methods", async () => {
    const server = await boot();
    const client = new TytoClient({ url: server.url, token: SAFE });
    await expect(client.call("session.list")).resolves.toEqual([]);
  });

  it("power token passes the scope gate for safe and power methods", async () => {
    const server = await boot();
    const client = new TytoClient({ url: server.url, token: POWER });
    await expect(client.call("session.list")).resolves.toEqual([]);
    const err = await client.call(POWER_METHODS[0]).catch((e: unknown) => e);
    expect((err as RpcError).code).not.toBe(RPC_ERROR.UNAUTHORIZED);
  });

  it("a cookie carrying the power token is not accepted", async () => {
    const server = await boot();
    const res = await raw(server, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `tyto_at=${POWER}` },
      body: rpcBody("session.list"),
    });
    expect(res.status).toBe(401);
  });

  it("request with a Host other than the loopback address and port → 403", async () => {
    const server = await boot();
    const get = await raw(server, { headers: { host: `evil.test:${server.port}` } });
    expect(get.status).toBe(403);
    const post = await raw(server, {
      method: "POST",
      headers: { host: `evil.test:${server.port}`, authorization: `Bearer ${POWER}`, "content-type": "application/json" },
      body: rpcBody("session.list"),
    });
    expect(post.status).toBe(403);
  });

  it("localhost:<port> is an accepted Host", async () => {
    const server = await boot();
    const res = await raw(server, { headers: { host: `localhost:${server.port}` } });
    expect(res.status).toBe(200);
  });

  it("POST with an Origin that is not the host origin → 403", async () => {
    const server = await boot();
    const res = await raw(server, {
      method: "POST",
      headers: { origin: "https://evil.test", authorization: `Bearer ${POWER}`, "content-type": "application/json" },
      body: rpcBody("session.list"),
    });
    expect(res.status).toBe(403);
  });

  it("POST with the host's own Origin is accepted", async () => {
    const server = await boot();
    const res = await raw(server, {
      method: "POST",
      headers: {
        origin: `http://127.0.0.1:${server.port}`,
        authorization: `Bearer ${SAFE}`,
        "content-type": "application/json",
      },
      body: rpcBody("session.list"),
    });
    expect(res.status).toBe(200);
  });

  it("an unauthenticated POST is refused before its body is read", async () => {
    const server = await boot();
    const res = await raw(server, {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "1000000" },
      body: "{",
      endBody: false,
    });
    expect(res.status).toBe(401);
  });
});

describe("host state files", () => {
  it("token files are written 0600 and host.json contains no token", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyto-home-"));
    await writeHostState(home, { url: "http://127.0.0.1:7420/", port: 7420, pid: 42 }, { power: POWER, safe: SAFE });
    const hostJson = await readFile(join(home, "host.json"), "utf8");
    expect(hostJson).not.toContain(POWER);
    expect(hostJson).not.toContain(SAFE);
    for (const scope of ["power", "safe"]) {
      const s = await stat(join(home, "tokens", scope));
      expect(s.mode & 0o777).toBe(0o600);
    }
    await expect(readHostState(home)).resolves.toEqual({
      url: "http://127.0.0.1:7420/",
      port: 7420,
      pid: 42,
      tokens: { power: POWER, safe: SAFE },
    });
  });

  it("readHostState returns null when no host has run", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyto-home-"));
    await expect(readHostState(home)).resolves.toBeNull();
  });
});
