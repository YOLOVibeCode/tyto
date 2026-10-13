import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executeRecipe, parseRecipe, runBatch, type BatchLine, type Recipe } from "@tyto/core";
import { composeDeps } from "../../src/index.ts";

// Live: real agent-browser lanes against a loopback page that names the owl in its path.
const run = promisify(execFile);
const LANES = ["tyto-rx-1", "tyto-rx-2", "tyto-rx-3"];
let server: Server;
let origin = "";

function recipe(path = "owl"): Recipe {
  const parsed = parseRecipe({
    name: "owl-name",
    version: 1,
    status: "draft",
    intent: "The owl named on the fixture page.",
    origins: [origin],
    params: { owl: { type: "string", description: "owl", example: "barn" } },
    steps: [["open", `${origin}/${path}/{{owl|path}}`], ["eval", "JSON.stringify({ name: document.querySelector('#name')?.textContent })"]],
    verify: { required: ["name"] },
  });
  if (!parsed.ok) throw new Error(parsed.errors.join("; "));
  return parsed.recipe;
}

/** Polls until no lane is among the sessions `tyto doctor` lists (a closed session's daemon exits within seconds). */
async function lanesGone(sessions: () => Promise<{ session: string }[]>, withinMs: number): Promise<string[]> {
  const deadline = Date.now() + withinMs;
  for (;;) {
    const left = (await sessions()).map((s) => s.session).filter((s) => LANES.includes(s));
    if (!left.length || Date.now() >= deadline) return left;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://fixture");
    const owl = decodeURIComponent(url.pathname.replace(/^\/(slow\/)?owl\//, ""));
    // /slow/owl/… answers after 400 ms, about what a real site takes.
    setTimeout(() => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<!doctype html><html><head><title>Owl</title></head><body><h1 id="name">${owl.replace(/[^a-z ]/g, "")} owl</h1></body></html>`);
    }, url.pathname.startsWith("/slow/") ? 400 : 0);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  origin = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  for (const session of [...LANES, "tyto-rx"]) await run("agent-browser", ["--session", session, "close"]).catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("live batch", () => {
  it("a batch over the fixture hits every input in order across lanes and closes them", async () => {
    const deps = await composeDeps({ ...process.env, TYTO_HOME: await mkdtemp(join(tmpdir(), "tyto-live-")) });
    const owls = ["barn", "snowy", "great horned", "burrowing", "elf", "screech"];
    const lines: BatchLine[] = [];

    const started = Date.now();
    const outcome = await runBatch(recipe(), owls.map((owl) => ({ owl })), deps.exec, { concurrency: 3, onLine: (line) => lines.push(line) });
    const batchMs = Date.now() - started;

    expect(outcome).toMatchObject({ kind: "done", code: 0, hits: 6, lanes: LANES });
    expect(lines.map((l) => [l.index, l.hit && l.result.name])).toEqual(owls.map((owl, i) => [i, `${owl} owl`]));
    expect(await lanesGone(deps.setup?.doctor.sessions ?? (async () => []), 15_000)).toEqual([]);
    console.log(`6 instant pages in 3 cold lanes: ${batchMs} ms`);
  }, 120_000);

  it("with 400 ms pages, 12 inputs finish sooner in 3 lanes than one after another in a warm tyto-rx", async () => {
    const deps = await composeDeps({ ...process.env, TYTO_HOME: await mkdtemp(join(tmpdir(), "tyto-live-")) });
    const owls = Array.from({ length: 12 }, (_, i) => `owl ${"abcdefghijkl"[i]}`);
    expect((await executeRecipe(recipe("slow/owl"), { owl: "warm" }, deps.exec)).kind).toBe("hit");

    let started = Date.now();
    for (const owl of owls) expect((await executeRecipe(recipe("slow/owl"), { owl }, deps.exec)).kind).toBe("hit");
    const sequentialMs = Date.now() - started;

    started = Date.now();
    const outcome = await runBatch(recipe("slow/owl"), owls.map((owl) => ({ owl })), deps.exec, { concurrency: 3, onLine: () => undefined });
    const batchMs = Date.now() - started;

    expect(outcome).toMatchObject({ kind: "done", code: 0, hits: 12 });
    console.log(`12 pages at 400 ms: one after another in warm tyto-rx ${sequentialMs} ms; 3 cold lanes ${batchMs} ms`);
    expect(batchMs).toBeLessThan(sequentialMs);
  }, 120_000);
});
