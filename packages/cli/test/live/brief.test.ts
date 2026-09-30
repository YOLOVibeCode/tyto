import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { composeDeps, main } from "../../src/index.ts";

// Live: real agent-browser against loopback pages with planted problems. Uses a throwaway agent-browser config
// (no saved logins) so the user's restore state is never touched.
const run = promisify(execFile);
const SESSION = `tyto-live-brief-${process.pid}`;
let server: Server;
let origin = "";
let abConfig = "";

const PAGES: Record<string, string> = {
  "/shop":
    '<!doctype html><title>Shop</title><main><h1>Shop</h1><ul id="list"><li>Loading…</li></ul></main><script>fetch("/api/items").then(r=>{if(!r.ok)throw new Error("items API failed: "+r.status);return r.json()}).catch(e=>{console.error(e.message);document.querySelector("#list").innerHTML="<li>No items</li>"})</script>',
  "/click":
    '<!doctype html><title>Editor</title><main><h1>Editor</h1><button id="save">Save</button><p>Conservation status</p><p>Vulnerable (IUCN 3.1)</p></main><script>document.querySelector("#save").addEventListener("click",()=>{const d=undefined;return d.id})</script>',
};

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/api/items") {
      res.writeHead(500, { "content-type": "application/json" });
      res.end('{"error":"database timeout"}');
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(PAGES[req.url ?? ""] ?? "<title>404</title>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  origin = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const dir = await mkdtemp(join(tmpdir(), "tyto-live-"));
  abConfig = join(dir, "ab.json");
  await writeFile(abConfig, "{}");
  process.env.AGENT_BROWSER_CONFIG = abConfig;
  process.env.TYTO_HOME = dir;
});

afterAll(async () => {
  await run("agent-browser", ["--session", SESSION, "close"], { env: { ...process.env, AGENT_BROWSER_CONFIG: abConfig } }).catch(() => undefined);
  delete process.env.AGENT_BROWSER_CONFIG;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function tyto(argv: string[]): Promise<{ code: number; text: string }> {
  const deps = await composeDeps(process.env);
  const lines: string[] = [];
  const code = await main([...argv, "--session", SESSION], { ...deps, out: (s) => lines.push(s), err: (s) => lines.push(s) });
  return { code, text: lines.join("\n") };
}

describe("live brief", () => {
  it("the brief shows a planted 500 with its body and the console error", async () => {
    const { code, text } = await tyto(["open", `${origin}/shop`]);
    expect(code).toBe(0);
    expect(text).toMatch(/network 500 GET \/api\/items \(Fetch\) → \{"error":"database timeout"\}/);
    expect(text).toMatch(/console\.error 'items API failed: 500'/);
  }, 60_000);

  it("a click reports the uncaught TypeError", async () => {
    await tyto(["open", `${origin}/click`]);
    const { text } = await tyto(["click", "#save"]);
    expect(text).toMatch(/✗ uncaught TypeError: Cannot read properties of undefined \(reading 'id'\)/);
  }, 60_000);

  it("find locates text anywhere on the page", async () => {
    const { code, text } = await tyto(["find", "conservation", "status"]);
    expect(code).toBe(0);
    expect(text).toMatch(/Conservation status ⏎ Vulnerable \(IUCN 3\.1\)/);
  }, 60_000);
});
