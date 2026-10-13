import { describe, expect, it } from "vitest";
import { parseRecipe, type Recipe } from "@tyto/core";
import { SecretRedactor } from "@tyto/core";
import { evalReturns, FakeBrowserRunner, FakeCompiler, FakeSessionLock, MemoryLogMarks, MemoryRecipeStore, MemoryTraceStore, stepFails } from "@tyto/core/testing";
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
  const deps: CliDeps = {
    store: new MemoryRecipeStore(...(recipes.length ? recipes : [recipe()])),
    exec: { runner, lock: new FakeSessionLock(), paths: { config: "/c.json", policy: "/p.json" } },
    browse: { runner, marks: new MemoryLogMarks(), redactor: new SecretRedactor(), session: "default", now: () => 0 },
    learn: { spawnListener: async () => undefined, control: async () => ({ ok: false }) },
    traces: new MemoryTraceStore(),
    compiler: new FakeCompiler(),
    compileTool: { dir: undefined, readStdin: async () => "" },
    confirm: async () => false,
    out: (s) => out.push(s),
    err: (s) => err.push(s),
  };
  return { deps, out, err, runner };
}

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
});
