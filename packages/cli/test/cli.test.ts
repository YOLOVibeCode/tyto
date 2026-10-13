import { describe, expect, it } from "vitest";
import { parseRecipe, type Recipe } from "@tyto/core";
import { SecretRedactor } from "@tyto/core";
import { evalReturns, FakeBrowserRunner, FakeCompiler, FakeSessionLock, MemoryLogMarks, MemoryRecipeStore, MemoryTraceStore, stepFails, type BatchScript } from "@tyto/core/testing";
import { main, type CliDeps } from "../src/index.ts";

function recipe(overrides: Record<string, unknown> = {}): Recipe {
  const parsed = parseRecipe({
    name: "release",
    version: 1,
    status: "draft",
    intent: "Newest release tag for a GitHub repo.",
    origins: ["https://github.com"],
    params: { repo: { type: "string", description: "owner/name", example: "a/b" } },
    steps: [["open", "https://github.com/{{repo|path}}/releases"], ["eval", "JSON.stringify({ tag: 'v1', url: location.href })"]],
    verify: { required: ["tag"] },
    ...overrides,
  });
  if (!parsed.ok) throw new Error(parsed.errors.join("; "));
  return parsed.recipe;
}

function harness(runner = new FakeBrowserRunner(evalReturns(JSON.stringify({ tag: "v1", url: "https://github.com/a/b/releases" }))), ...recipes: Recipe[]) {
  const out: string[] = [];
  const err: string[] = [];
  const files = new Map<string, string>();
  const read: string[] = [];
  const deps: CliDeps = {
    store: new MemoryRecipeStore(...(recipes.length ? recipes : [recipe()])),
    exec: { runner, lock: new FakeSessionLock(), paths: { config: "/c.json", policy: "/p.json" } },
    browse: { runner, marks: new MemoryLogMarks(), redactor: new SecretRedactor(), session: "default", now: () => 0 },
    learn: { spawnListener: async () => undefined, control: async () => ({ ok: false }) },
    traces: new MemoryTraceStore(),
    compiler: new FakeCompiler(),
    compileTool: { dir: undefined, readStdin: async () => "" },
    confirm: async () => false,
    readInput: async (path) => {
      read.push(path);
      const text = files.get(path);
      if (text === undefined) throw new Error(`cannot read ${path}`);
      return text;
    },
    out: (s) => out.push(s),
    err: (s) => err.push(s),
  };
  return { deps, out, err, runner, files, read };
}

/** The eval returns the repo the batch rendered, so each line can be checked against its input. */
const echoRepo: BatchScript = (steps, opts) => {
  const repo = /github\.com\/(.+)\/releases/.exec(steps[0]?.[1] ?? "")?.[1] ?? "";
  return repo === "gone/x" ? stepFails(0, "Timeout")(steps, opts) : evalReturns(JSON.stringify({ tag: "v1", repo }))(steps, opts);
};

describe("tyto CLI", () => {
  it("tyto run prints the result JSON and exits 0 on a hit", async () => {
    const h = harness();
    expect(await main(["run", "release", "--repo", "a/b"], h.deps)).toBe(0);
    expect(JSON.parse(h.out.join(""))).toEqual({ tag: "v1", url: "https://github.com/a/b/releases" });
  });

  it("tyto run prints the miss and exits 3", async () => {
    const h = harness(new FakeBrowserRunner(stepFails(0, "Timeout")));
    expect(await main(["run", "release", "--repo", "a/b"], h.deps)).toBe(3);
    expect(JSON.parse(h.out.join(""))).toMatchObject({ miss: expect.stringMatching(/Timeout/), step: 1 });
  });

  it("tyto run parses --param value and --param=value", async () => {
    const h = harness();
    expect(await main(["run", "release", "--repo=a/b"], h.deps)).toBe(0);
    expect(h.runner.batches[0]?.steps[0]).toEqual(["open", "https://github.com/a/b/releases"]);
  });

  it("tyto run with an unknown recipe exits 64", async () => {
    const h = harness();
    expect(await main(["run", "nope"], h.deps)).toBe(64);
    expect(h.err.join("")).toMatch(/nope/);
  });

  it("tyto recipes lists name, intent, and params", async () => {
    const h = harness();
    expect(await main(["recipes"], h.deps)).toBe(0);
    const text = h.out.join("\n");
    expect(text).toMatch(/release/);
    expect(text).toMatch(/Newest release tag/);
    expect(text).toMatch(/repo/);
    expect(await main(["recipes", "--json"], h.deps)).toBe(0);
  });

  it("tyto test runs every regression case and exits 3 if any fails", async () => {
    const withCases = recipe({
      regression: [
        { params: { repo: "a/b" }, expect: { tag: "v1" } },
        { params: { repo: "c/d" }, expect: { tag: "v2" } },
      ],
    });
    const h = harness(undefined, withCases);
    expect(await main(["test", "release"], h.deps)).toBe(3);
    expect(h.out.join("\n")).toMatch(/1\/2 passed/);
  });

  it("unknown command exits 64 with usage", async () => {
    const h = harness();
    expect(await main(["frobnicate"], h.deps)).toBe(64);
    expect(h.err.join("")).toMatch(/usage/i);
  });

  it("tyto run --each prints one JSON line per input, in input order, and exits 0 when all hit", async () => {
    const h = harness(new FakeBrowserRunner(echoRepo));
    h.files.set("repos.jsonl", '{"repo":"a/1"}\n{"repo":"a/2"}\n{"repo":"a/3"}\n');
    expect(await main(["run", "release", "--each", "repos.jsonl", "--concurrency", "2"], h.deps)).toBe(0);
    expect(h.out.map((line) => JSON.parse(line))).toEqual([
      { index: 0, input: { repo: "a/1" }, hit: true, result: { tag: "v1", repo: "a/1" } },
      { index: 1, input: { repo: "a/2" }, hit: true, result: { tag: "v1", repo: "a/2" } },
      { index: 2, input: { repo: "a/3" }, hit: true, result: { tag: "v1", repo: "a/3" } },
    ]);
    expect(new Set(h.runner.batches.map((b) => b.opts.session))).toEqual(new Set(["tyto-rx-1", "tyto-rx-2"]));
  });

  it("tyto run --each - reads the inputs from stdin", async () => {
    const h = harness(new FakeBrowserRunner(echoRepo));
    h.files.set("-", '{"repo":"a/1"}\n');
    expect(await main(["run", "release", "--each", "-"], h.deps)).toBe(0);
    expect(h.read).toEqual(["-"]);
  });

  it("tyto run --each adds the other --param flags to every input, and a line's own value wins", async () => {
    const two = recipe({
      params: { repo: { type: "string", description: "owner/name", example: "a/b" }, tab: { type: "string", description: "tab", example: "releases" } },
      steps: [["open", "https://github.com/{{repo|path}}/{{tab}}"], ["eval", "JSON.stringify({ tag: 'v1' })"]],
    });
    const h = harness(undefined, two);
    h.files.set("in.jsonl", '{"repo":"a/1"}\n{"repo":"a/2","tab":"tags"}\n');
    expect(await main(["run", "release", "--tab", "releases", "--each", "in.jsonl"], h.deps)).toBe(0);
    expect(h.runner.batches.map((b) => b.steps[0]?.[1]).sort()).toEqual(["https://github.com/a/1/releases", "https://github.com/a/2/tags"]);
  });

  it("tyto run --each prints a summary and the repair command for the first miss on stderr, and exits 3", async () => {
    const h = harness(new FakeBrowserRunner(echoRepo));
    h.files.set("in.jsonl", '{"repo":"a/1"}\n{"repo":"gone/x"}\n');
    expect(await main(["run", "release", "--each", "in.jsonl"], h.deps)).toBe(3);
    expect(JSON.parse(h.out[1] ?? "")).toMatchObject({ index: 1, hit: false, miss: expect.stringMatching(/Timeout/), step: 1 });
    expect(h.err).toEqual(["batch release: 1 hit, 1 miss, 0 errors (2 lanes)", 'repair: tyto repair release --repo "gone/x"']);
  });

  it("tyto run --each records the inputs that hit as regression cases", async () => {
    const h = harness(new FakeBrowserRunner(echoRepo));
    h.files.set("in.jsonl", '{"repo":"a/1"}\n{"repo":"gone/x"}\n{"repo":"a/3"}\n');
    await main(["run", "release", "--each", "in.jsonl"], h.deps);
    expect((await h.deps.store.get("release"))?.regression.map((c) => c.params)).toEqual([{ repo: "a/1" }, { repo: "a/3" }]);
  });

  it("tyto run --each with a bad line exits 64 and names the line, before any browser call", async () => {
    const h = harness(new FakeBrowserRunner(echoRepo));
    h.files.set("in.jsonl", '{"repo":"a/1"}\n["a/2"]\n');
    expect(await main(["run", "release", "--each", "in.jsonl"], h.deps)).toBe(64);
    expect(h.err.join("\n")).toMatch(/in\.jsonl: line 2: expected a JSON object/);
    expect(h.runner.batches).toHaveLength(0);
  });

  it("tyto run --concurrency must be 1 to 8 and needs --each", async () => {
    for (const bad of ["0", "9", "two", "1.5"]) {
      const h = harness();
      h.files.set("in.jsonl", '{"repo":"a/1"}\n');
      expect(await main(["run", "release", "--each", "in.jsonl", "--concurrency", bad], h.deps)).toBe(64);
    }
    const h = harness();
    expect(await main(["run", "release", "--repo", "a/b", "--concurrency", "2"], h.deps)).toBe(64);
    expect(h.err.join("")).toMatch(/--concurrency needs --each/);
  });

  it("tyto run --each with a file it cannot read exits 64", async () => {
    const h = harness();
    expect(await main(["run", "release", "--each", "missing.jsonl"], h.deps)).toBe(64);
    expect(h.err.join("")).toMatch(/cannot read missing\.jsonl/);
  });
});
