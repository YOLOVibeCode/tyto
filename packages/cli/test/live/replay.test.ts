import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executeRecipe, parseRecipe, type Recipe } from "@tyto/core";
import { composeDeps } from "../../src/index.ts";

// Live: real agent-browser (browser from the user's agent-browser config) against a loopback page.
const run = promisify(execFile);
let server: Server;
let origin = "";
let variant: "v1" | "v2" = "v1";

function page(): string {
  const status = variant === "v1" ? '<span id="status">Least Concern</span>' : "<span>moved</span>";
  return `<!doctype html><html><head><title>Owl</title></head><body><h1 id="name">Barn owl</h1>${status}</body></html>`;
}

function recipe(steps: string[][]): Recipe {
  const parsed = parseRecipe({
    name: "owl-status",
    version: 1,
    status: "draft",
    intent: "Status on the fixture page.",
    origins: [origin],
    steps: [["open", `${origin}/owl`], ...steps, ["eval", "JSON.stringify({ name: document.querySelector('#name')?.textContent, status: document.querySelector('#status')?.textContent, url: location.href })"]],
    verify: { required: ["name", "status"] },
  });
  if (!parsed.ok) throw new Error(parsed.errors.join("; "));
  return parsed.recipe;
}

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(page());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  origin = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  await run("agent-browser", ["--session", "tyto-rx", "close"]).catch(() => undefined); // fresh daemon picks up the 6 s timeout
});

afterAll(async () => {
  await run("agent-browser", ["--session", "tyto-rx", "close"]).catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("live replay", () => {
  it("a fixture recipe hits, then misses after the page changes", async () => {
    const deps = await composeDeps({ ...process.env, TYTO_HOME: await mkdtemp(join(tmpdir(), "tyto-live-")) });
    variant = "v1";
    const hit = await executeRecipe(recipe([]), {}, deps.exec);
    expect(hit).toMatchObject({ kind: "hit", result: { name: "Barn owl", status: "Least Concern" } });
    variant = "v2";
    const miss = await executeRecipe(recipe([]), {}, deps.exec);
    expect(miss).toMatchObject({ kind: "miss", miss: "required field empty: status" });
  }, 60_000);

  it("a missing locator fails in under 7 s", async () => {
    const deps = await composeDeps({ ...process.env, TYTO_HOME: await mkdtemp(join(tmpdir(), "tyto-live-")) });
    variant = "v1";
    const started = Date.now();
    const out = await executeRecipe(recipe([["click", "#does-not-exist"]]), {}, deps.exec);
    expect(out.kind).toBe("miss");
    expect(Date.now() - started).toBeLessThan(7_000);
  }, 60_000);
});
