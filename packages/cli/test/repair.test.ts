import { describe, expect, it } from "vitest";
import { SecretRedactor, parseRecipe, type BatchStepResult, type Recipe } from "@tyto/core";
import {
  FakeBrowserRunner,
  FakeCompiler,
  FakeSessionLock,
  MemoryLogMarks,
  MemoryRecipeStore,
  MemoryTraceStore,
} from "@tyto/core/testing";
import { main, type CliDeps } from "../src/index.ts";

const OLD_EVAL = "JSON.stringify({ tag: document.title === 'node' ? '' : 'v1', url: location.href, version: 'old' })";
const NEW_EVAL = "JSON.stringify({ tag: 'v1', url: location.href, version: 'new' })";

function recipe(overrides: Record<string, unknown> = {}): Recipe {
  const parsed = parseRecipe({
    name: "gh-release",
    version: 1,
    status: "draft",
    intent: "Latest release tag.",
    origins: ["https://github.com"],
    params: { repo: { type: "string", description: "owner/name", example: "a/b" } },
    steps: [["open", "https://github.com/{{repo|path}}/releases"], ["eval", OLD_EVAL]],
    verify: { required: ["tag"] },
    regression: [{ params: { repo: "a/b" }, expect: {} }],
    ...overrides,
  });
  if (!parsed.ok) throw new Error(parsed.errors.join("; "));
  return parsed.recipe;
}

const decode = (b64: string): string => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));

/**
 * Old recipe: misses on nodejs/node. New recipe: hits everything, unless `newBreaks` names a repo it misses.
 */
function browser(newBreaks?: string): FakeBrowserRunner {
  return new FakeBrowserRunner((steps): BatchStepResult[] => {
    const url = steps[0]?.[1] ?? "";
    const code = decode(steps.at(-1)?.[2] ?? "");
    const isNew = code.includes("'new'");
    const miss = isNew ? (newBreaks !== undefined && url.includes(newBreaks)) : url.includes("nodejs/node");
    return steps.map((command, i) => ({
      command,
      success: true,
      result: i === steps.length - 1 ? { result: JSON.stringify({ tag: miss ? "" : "v1", url }) } : {},
      error: null,
    }));
  });
}

function harness(opts: { reply?: string; newBreaks?: string; old?: Recipe } = {}) {
  const runner = browser(opts.newBreaks);
  const store = new MemoryRecipeStore(opts.old ?? recipe());
  const repaired = { ...JSON.parse(JSON.stringify(opts.old ?? recipe())), steps: [["open", "https://github.com/{{repo|path}}/releases"], ["eval", NEW_EVAL]] };
  const compiler = new FakeCompiler(opts.reply ?? "```json\n" + JSON.stringify(repaired) + "\n```");
  const out: string[] = [];
  const deps: CliDeps = {
    store,
    exec: { runner, lock: new FakeSessionLock(), paths: { config: "/c", policy: "/p" } },
    browse: { runner, marks: new MemoryLogMarks(), redactor: new SecretRedactor(), session: "default", now: () => 0 },
    learn: { spawnListener: async () => undefined, control: async () => ({ ok: false }) },
    traces: new MemoryTraceStore(),
    compiler,
    compileTool: { dir: undefined, readStdin: async () => "" },
    confirm: async () => false,
    out: (s) => out.push(s),
    err: (s) => out.push(`ERR ${s}`),
  };
  return { deps, out, store, compiler };
}

describe("tyto repair", () => {
  it("on a miss, repair receives the missed inputs with reasons and the regression inputs", async () => {
    const h = harness();
    await main(["repair", "gh-release", "--repo", "nodejs/node"], h.deps);
    const prompt = h.compiler.requests[0]?.prompt ?? "";
    expect(prompt).toMatch(/nodejs\/node[\s\S]*required field empty: tag/);
    expect(prompt).toMatch(/Previously passing inputs[\s\S]*a\/b/);
  });

  it("a successful repair replaces the recipe and remembers the missed input", async () => {
    const h = harness();
    expect(await main(["repair", "gh-release", "--repo", "nodejs/node"], h.deps)).toBe(0);
    const saved = await h.store.get("gh-release");
    expect(saved?.steps[1]?.[1]).toBe(NEW_EVAL);
    expect(saved?.regression.map((c) => c.params.repo)).toEqual(["a/b", "nodejs/node"]);
  });

  it("a repaired recipe must pass every regression input before replacing the old one", async () => {
    const h = harness({ newBreaks: "a/b" });
    expect(await main(["repair", "gh-release", "--repo", "nodejs/node"], h.deps)).toBe(3);
    expect((await h.store.get("gh-release"))?.steps[1]?.[1]).toBe(OLD_EVAL);
    expect(h.out.join("\n")).toMatch(/a\/b/);
  });

  it("repair output that fails lint leaves the old recipe unchanged", async () => {
    const bad = { ...JSON.parse(JSON.stringify(recipe())), steps: [["open", "https://github.com/"], ["eval", "fetch('/x')"]] };
    const h = harness({ reply: "```json\n" + JSON.stringify(bad) + "\n```" });
    expect(await main(["repair", "gh-release", "--repo", "nodejs/node"], h.deps)).toBe(65);
    expect((await h.store.get("gh-release"))?.steps[1]?.[1]).toBe(OLD_EVAL);
  });

  it("an input the recipe already answers needs no repair", async () => {
    const h = harness();
    expect(await main(["repair", "gh-release", "--repo", "a/b"], h.deps)).toBe(0);
    expect(h.compiler.requests).toHaveLength(0);
  });

  it("a repaired auth recipe is saved as a draft that needs approval again", async () => {
    const h = harness({ old: recipe({ auth: true, status: "approved" }) });
    expect(await main(["repair", "gh-release", "--repo", "nodejs/node"], h.deps)).toBe(0);
    const saved = await h.store.get("gh-release");
    expect(saved?.status).toBe("draft");
    expect(h.out.join("\n")).toMatch(/tyto recipes approve gh-release/);
  });
});

describe("tyto run and regression", () => {
  it("tyto run records passing inputs in the regression list", async () => {
    const h = harness();
    expect(await main(["run", "gh-release", "--repo", "vercel/next.js"], h.deps)).toBe(0);
    expect((await h.store.get("gh-release"))?.regression.map((c) => c.params.repo)).toEqual(["a/b", "vercel/next.js"]);
  });

  it("tyto run prints a repair hint on a miss", async () => {
    const h = harness();
    expect(await main(["run", "gh-release", "--repo", "nodejs/node"], h.deps)).toBe(3);
    expect(h.out.join("\n")).toMatch(/tyto repair gh-release --repo "nodejs\/node"/);
  });
});
