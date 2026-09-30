import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Trace } from "@tyto/core";
import { composeDeps } from "../../src/index.ts";

// Live: record a real agent-browser session through its event stream (throwaway config, loopback page).
const run = promisify(execFile);
const SESSION = `tyto-live-learn-${process.pid}`;
let server: Server;
let origin = "";
let home = "";
const env = (): NodeJS.ProcessEnv => ({ ...process.env, AGENT_BROWSER_CONFIG: join(home, "ab.json"), TYTO_HOME: home });
const ab = (...args: string[]) => run("agent-browser", ["--session", SESSION, ...args], { env: env() });

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end('<!doctype html><title>Search</title><label>City <input id="city"></label><button id="go">Go</button>');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  origin = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  home = await mkdtemp(join(tmpdir(), "tyto-live-learn-"));
  await writeFile(join(home, "ab.json"), "{}");
});

afterAll(async () => {
  await ab("close").catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("live learn", () => {
  it("records command/result pairs from the event stream and keeps only the named input", async () => {
    const deps = await composeDeps(env());
    await ab("get", "url");
    const listening = deps.learn.listen?.("city-search", SESSION);
    for (let i = 0; i < 100; i += 1) {
      const ready = await deps.learn.control("city-search", { op: "status" }).catch(() => null);
      if (ready?.ok) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await ab("open", `${origin}/`);
    await ab("fill", "#city", "Paris");
    await ab("click", "#go");
    const reply = await deps.learn.control("city-search", { op: "stop", task: "search a city", keep: { input_1: "city" } });
    await listening;
    expect(reply).toMatchObject({ ok: true, steps: 3, lossy: false, params: { city: "Paris" } });
    const trace = JSON.parse(await readFile(join(home, "traces", "city-search.json"), "utf8")) as Trace;
    expect(trace.steps.map((s) => s.argv)).toEqual([["open", `${origin}/`], ["fill", "#city", "{{city}}"], ["click", "#go"]]);
  }, 60_000);
});
