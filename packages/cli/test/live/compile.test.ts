import { createServer, type Server } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executeRecipe, type Trace } from "@tyto/core";
import { composeDeps, main } from "../../src/index.ts";

// Live compiler (opt-in: TYTO_LIVE_COMPILER=1): a real `claude -p` session compiles a trace against a loopback
// site, then the recipe must answer unseen inputs with no model.
const STATUS: Record<string, string> = { "barn-owl": "Least Concern", "snowy-owl": "Vulnerable", tiger: "Endangered", "red-fox": "Least Concern" };
let server: Server;
let origin = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    const slug = /^\/species\/([a-z-]+)$/.exec(req.url ?? "")?.[1] ?? "";
    const status = STATUS[slug];
    res.writeHead(status ? 200 : 404, { "content-type": "text/html" });
    res.end(status ? `<!doctype html><title>${slug}</title><h1>${slug}</h1><table class="facts"><tr><th>Conservation status</th><td class="status">${status}</td></tr></table>` : "<title>Not found</title>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  origin = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe.runIf(process.env.TYTO_LIVE_COMPILER === "1")("live compile", () => {
  it("a compiled recipe passes lint and its self-test, then answers unseen inputs", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyto-live-compile-"));
    const deps = await composeDeps({ ...process.env, TYTO_HOME: home });
    const trace: Trace = {
      name: "species-status",
      task: "Conservation status of a species on the fixture site",
      session: "s",
      startedAt: 0,
      stoppedAt: 1,
      lossy: false,
      gaps: [],
      origins: [origin],
      params: { species: "snowy-owl" },
      steps: [
        { argv: ["open", `${origin}/species/{{species}}`], action: "navigate", output: "", error: null },
        { argv: ["eval", "document.querySelector('td.status').textContent"], action: "evaluate", output: "Vulnerable", error: null },
      ],
    };
    await deps.traces.save(trace);
    const lines: string[] = [];
    const code = await main(["compile", "species-status"], { ...deps, out: (s) => lines.push(s), err: (s) => lines.push(s) });
    expect(code, lines.join("\n")).toBe(0);
    const recipe = await deps.store.get("species-status");
    expect(recipe).not.toBeNull();
    for (const [species, status] of [["tiger", "Endangered"], ["red-fox", "Least Concern"]] as const) {
      const out = await executeRecipe(recipe!, { [Object.keys(recipe!.params)[0] ?? "species"]: species }, deps.exec);
      expect(out.kind, JSON.stringify(out)).toBe("hit");
      if (out.kind === "hit") expect(JSON.stringify(out.result)).toContain(status);
    }
  }, 600_000);
});
