import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SecretRedactor, type BatchStepResult, type Trace } from "@tyto/core";
import {
  FakeBrowserRunner,
  FakeCompiler,
  FakeSessionLock,
  MemoryLogMarks,
  MemoryRecipeStore,
  MemoryTraceStore,
  evalReturns,
} from "@tyto/core/testing";
import { main, type CliDeps } from "../src/index.ts";

const RECIPE = {
  name: "wiki-status",
  version: 1,
  status: "draft",
  intent: "IUCN status from the infobox.",
  origins: ["https://en.wikipedia.org"],
  params: { species: { type: "string", description: "species", example: "Snowy owl" } },
  steps: [["open", "https://en.wikipedia.org/wiki/{{species|underscore}}"], ["eval", "JSON.stringify({ status: 'Vulnerable', url: location.href })"]],
  verify: { required: ["status"] },
};

const TRACE: Trace = {
  name: "wiki-status",
  task: "IUCN status of a species",
  session: "s",
  startedAt: 0,
  stoppedAt: 1,
  lossy: false,
  gaps: [],
  origins: ["https://en.wikipedia.org"],
  params: { species: "Snowy owl" },
  steps: [{ argv: ["open", "https://en.wikipedia.org"], action: "navigate", output: "", error: null }],
};

async function harness(opts: { compileDir?: boolean; stdin?: string; reply?: string; confirm?: boolean } = {}) {
  const runner = new FakeBrowserRunner(evalReturns(JSON.stringify({ status: "Vulnerable", url: "https://en.wikipedia.org/wiki/Tiger" })));
  runner.onRun = () => ({ exitCode: 0, stdout: "✓ Tiger - Wikipedia", stderr: "" });
  const store = new MemoryRecipeStore();
  const traces = new MemoryTraceStore();
  await traces.save(TRACE);
  let dir: string | undefined;
  if (opts.compileDir) {
    dir = await mkdtemp(join(tmpdir(), "tyto-ct-"));
    await writeFile(join(dir, "context.json"), JSON.stringify({ name: "wiki-status", origins: TRACE.origins, domains: ["upload.wikimedia.org"] }));
  }
  const compiler = new FakeCompiler(opts.reply ?? "```json\n" + JSON.stringify(RECIPE) + "\n```");
  const questions: string[] = [];
  const out: string[] = [];
  const deps: CliDeps = {
    store,
    exec: { runner, lock: new FakeSessionLock(), paths: { config: "/tyto/ab.json", policy: "/tyto/policy.json" } },
    browse: { runner, marks: new MemoryLogMarks(), redactor: new SecretRedactor(), session: "default", now: () => 0 },
    learn: { spawnListener: async () => undefined, control: async () => ({ ok: false }) },
    traces,
    compiler,
    compileTool: { dir, readStdin: async () => opts.stdin ?? "" },
    confirm: async (q) => {
      questions.push(q);
      return opts.confirm ?? false;
    },
    out: (s) => out.push(s),
    err: (s) => out.push(`ERR ${s}`),
  };
  return { deps, out, runner, store, compiler, questions, dir };
}

describe("tyto compile-tool", () => {
  it("compile-tool refuses to run outside a compile", async () => {
    const h = await harness();
    expect(await main(["compile-tool", "test", "d1"], h.deps)).toBe(64);
  });

  it("compile-tool draft validates, lints, and saves a draft", async () => {
    const h = await harness({ compileDir: true, stdin: JSON.stringify(RECIPE) });
    expect(await main(["compile-tool", "draft"], h.deps)).toBe(0);
    expect(h.out.join("\n")).toMatch(/draft d1 saved/);
    expect(JSON.parse(await readFile(join(h.dir ?? "", "drafts", "d1.json"), "utf8")).name).toBe("wiki-status");

    const bad = await harness({ compileDir: true, stdin: JSON.stringify({ ...RECIPE, origins: ["https://evil.test"], steps: [["open", "https://evil.test/"], RECIPE.steps[1]] }) });
    expect(await main(["compile-tool", "draft"], bad.deps)).toBe(65);
    expect(bad.out.join("\n")).toMatch(/origins not visited/);
  });

  it("compile-tool test runs the executor on the given params", async () => {
    const h = await harness({ compileDir: true, stdin: JSON.stringify(RECIPE) });
    await main(["compile-tool", "draft"], h.deps);
    h.out.length = 0;
    expect(await main(["compile-tool", "test", "d1", "--species", "Tiger"], h.deps)).toBe(0);
    expect(h.runner.batches[0]?.steps[0]).toEqual(["open", "https://en.wikipedia.org/wiki/Tiger"]);
    expect(JSON.parse(h.out.join(""))).toMatchObject({ hit: { status: "Vulnerable" } });
  });

  it("compile-tool ab pins session tyto-compile with --allowed-domains from the trace origins", async () => {
    const h = await harness({ compileDir: true });
    expect(await main(["compile-tool", "ab", "open", "https://en.wikipedia.org/wiki/Tiger"], h.deps)).toBe(0);
    const call = h.runner.runs.at(-1);
    expect(call?.argv).toEqual(["open", "https://en.wikipedia.org/wiki/Tiger"]);
    expect(call?.opts.session).toBe("tyto-compile");
    expect(call?.opts.args).toEqual(["--allowed-domains", "en.wikipedia.org,upload.wikimedia.org", "--content-boundaries", "--action-policy", "/tyto/policy.json"]);
    expect(call?.opts.env).toEqual({ AGENT_BROWSER_CONFIG: "/tyto/ab.json" });
  });
});

describe("tyto compile", () => {
  it("saves a valid compiled recipe as a draft and prints how to run it", async () => {
    const h = await harness();
    expect(await main(["compile", "wiki-status"], h.deps)).toBe(0);
    expect((await h.store.get("wiki-status"))?.status).toBe("draft");
    expect(h.compiler.requests[0]?.context).toEqual({ name: "wiki-status", origins: ["https://en.wikipedia.org"], domains: [] });
    expect(h.out.join("\n")).toMatch(/tyto run wiki-status --species "Snowy owl"/);
  });

  it("rejects compiler output that fails lint and saves nothing", async () => {
    const h = await harness({ reply: "```json\n" + JSON.stringify({ ...RECIPE, steps: [["open", "https://en.wikipedia.org/"], ["eval", "fetch('/x')"]] }) + "\n```" });
    expect(await main(["compile", "wiki-status"], h.deps)).toBe(65);
    expect(await h.store.get("wiki-status")).toBeNull();
  });

  it("an unknown trace exits 64", async () => {
    const h = await harness();
    expect(await main(["compile", "nope"], h.deps)).toBe(64);
  });
});

describe("tyto recipes approve", () => {
  it("shows the steps and marks the recipe approved after confirmation", async () => {
    const h = await harness({ confirm: true });
    await main(["compile", "wiki-status"], h.deps);
    h.out.length = 0;
    expect(await main(["recipes", "approve", "wiki-status"], h.deps)).toBe(0);
    expect(h.out.join("\n")).toMatch(/open https:\/\/en\.wikipedia\.org\/wiki\/\{\{species\|underscore\}\}/);
    expect(h.questions).toHaveLength(1);
    expect((await h.store.get("wiki-status"))?.status).toBe("approved");
  });

  it("leaves the recipe a draft when not confirmed", async () => {
    const h = await harness({ confirm: false });
    await main(["compile", "wiki-status"], h.deps);
    expect(await main(["recipes", "approve", "wiki-status"], h.deps)).toBe(64);
    expect((await h.store.get("wiki-status"))?.status).toBe("draft");
  });

  it("--yes approves without asking", async () => {
    const h = await harness({ confirm: false });
    await main(["compile", "wiki-status"], h.deps);
    expect(await main(["recipes", "approve", "wiki-status", "--yes"], h.deps)).toBe(0);
    expect(h.questions).toHaveLength(0);
  });
});
