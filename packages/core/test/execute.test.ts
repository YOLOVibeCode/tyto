import { describe, expect, it } from "vitest";
import { AgentBrowserMissingError, EXIT, executeRecipe, parseRecipe, type Recipe } from "../src/index.ts";
import { FakeBrowserRunner, FakeSessionLock, evalReturns, stepFails } from "../src/testing/index.ts";

const PATHS = { config: "/tmp/tyto/agent-browser.json", policy: "/tmp/tyto/policy.json" };

function recipe(overrides: Record<string, unknown> = {}): Recipe {
  const parsed = parseRecipe({
    name: "release",
    version: 1,
    status: "draft",
    auth: false,
    intent: "Newest release tag.",
    examples: [],
    origins: ["https://github.com", "https://api.github.com"],
    params: { repo: { type: "string", description: "owner/name", example: "a/b" } },
    steps: [
      ["open", "https://github.com/{{repo|path}}/releases"],
      ["wait", "--url", "**/releases"],
      ["eval", "JSON.stringify({ tag: 'v1', url: location.href })"],
    ],
    verify: { required: ["tag", "url"], match: { url: "github\\.com/{{repo}}/releases" } },
    ...overrides,
  });
  if (!parsed.ok) throw new Error(parsed.errors.join("; "));
  return parsed.recipe;
}

const GOOD = { tag: "v1", url: "https://github.com/a/b/releases" };

function deps(runner: FakeBrowserRunner, lock = new FakeSessionLock()) {
  return { runner, lock, paths: PATHS };
}

describe("executeRecipe", () => {
  it("runs all steps as one batch in session tyto-rx with --allowed-domains from origins", async () => {
    const runner = new FakeBrowserRunner(evalReturns(JSON.stringify(GOOD)));
    await executeRecipe(recipe(), { repo: "a/b" }, deps(runner));
    expect(runner.batches).toHaveLength(1);
    const call = runner.batches[0];
    expect(call?.steps).toHaveLength(3);
    expect(call?.opts.session).toBe("tyto-rx");
    expect(call?.opts.args).toEqual(["--allowed-domains", "github.com,api.github.com", "--action-policy", PATHS.policy]);
  });

  it("the domain allowlist also includes the recipe's extra network domains", async () => {
    const runner = new FakeBrowserRunner(evalReturns(JSON.stringify(GOOD)));
    await executeRecipe(recipe({ domains: ["github.githubassets.com", "*.githubusercontent.com"] }), { repo: "a/b" }, deps(runner));
    expect(runner.batches[0]?.opts.args?.[1]).toBe("github.com,api.github.com,github.githubassets.com,*.githubusercontent.com");
  });

  it("a hit returns the verified result", async () => {
    const runner = new FakeBrowserRunner(evalReturns(JSON.stringify(GOOD)));
    const out = await executeRecipe(recipe(), { repo: "a/b" }, deps(runner));
    expect(out).toEqual({ kind: "hit", result: GOOD, params: { repo: "a/b" } });
  });

  it("a failing step misses with the step index", async () => {
    const runner = new FakeBrowserRunner(stepFails(1, "Timeout waiting for URL **/releases"));
    const out = await executeRecipe(recipe(), { repo: "a/b" }, deps(runner));
    expect(out.kind).toBe("miss");
    if (out.kind === "miss") {
      expect(out.step).toBe(2);
      expect(out.miss).toMatch(/wait/);
    }
  });

  it("a verify failure after a successful batch misses at the last step", async () => {
    const runner = new FakeBrowserRunner(evalReturns(JSON.stringify({ tag: "", url: GOOD.url })));
    const out = await executeRecipe(recipe(), { repo: "a/b" }, deps(runner));
    expect(out).toMatchObject({ kind: "miss", step: 3 });
  });

  it("retries once on a browser launch error and never on element-not-found", async () => {
    const launch = new FakeBrowserRunner(stepFails(0, "Chrome exited early (exit code: 21) without writing DevToolsActivePort"), evalReturns(JSON.stringify(GOOD)));
    expect((await executeRecipe(recipe(), { repo: "a/b" }, deps(launch))).kind).toBe("hit");
    expect(launch.batches).toHaveLength(2);

    const missing = new FakeBrowserRunner(stepFails(1, "Element not found: #nope"), evalReturns(JSON.stringify(GOOD)));
    expect((await executeRecipe(recipe(), { repo: "a/b" }, deps(missing))).kind).toBe("miss");
    expect(missing.batches).toHaveLength(1);
  });

  it("sets AGENT_BROWSER_DEFAULT_TIMEOUT and the Tyto config for the batch", async () => {
    const runner = new FakeBrowserRunner(evalReturns(JSON.stringify(GOOD)));
    await executeRecipe(recipe(), { repo: "a/b" }, deps(runner));
    expect(runner.batches[0]?.opts.env).toEqual({ AGENT_BROWSER_DEFAULT_TIMEOUT: "6000", AGENT_BROWSER_CONFIG: PATHS.config });
  });

  it("stops at the overall deadline with exit 70", async () => {
    const hang = new FakeBrowserRunner(
      (_steps, opts) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener("abort", () => reject(opts.signal?.reason));
        }),
    );
    const out = await executeRecipe(recipe(), { repo: "a/b" }, deps(hang), { deadlineMs: 20 });
    expect(out).toMatchObject({ kind: "error", code: EXIT.internal });
  });

  it("an auth recipe runs in tyto-rx-auth only when approved, otherwise exits 77", async () => {
    const runner = new FakeBrowserRunner(evalReturns(JSON.stringify(GOOD)));
    const draft = await executeRecipe(recipe({ auth: true }), { repo: "a/b" }, deps(runner));
    expect(draft).toMatchObject({ kind: "error", code: EXIT.notApproved });
    expect(runner.batches).toHaveLength(0);

    const approved = await executeRecipe(recipe({ auth: true, status: "approved" }), { repo: "a/b" }, deps(runner));
    expect(approved.kind).toBe("hit");
    expect(runner.batches[0]?.opts.session).toBe("tyto-rx-auth");
    expect(runner.batches[0]?.opts.args).toEqual(["--restore", "main", "--action-policy", PATHS.policy]);
  });

  it("a busy session exits 75", async () => {
    const lock = new FakeSessionLock();
    lock.busy = true;
    const runner = new FakeBrowserRunner(evalReturns(JSON.stringify(GOOD)));
    const out = await executeRecipe(recipe(), { repo: "a/b" }, deps(runner, lock));
    expect(out).toMatchObject({ kind: "error", code: EXIT.busy });
    expect(runner.batches).toHaveLength(0);
  });

  it("the session lock is released after the run", async () => {
    const lock = new FakeSessionLock();
    await executeRecipe(recipe(), { repo: "a/b" }, deps(new FakeBrowserRunner(stepFails(0, "boom")), lock));
    expect(lock.held.size).toBe(0);
    expect(lock.acquired).toEqual(["tyto-rx"]);
  });

  it("a missing agent-browser binary exits 69", async () => {
    const runner = new FakeBrowserRunner(() => {
      throw new AgentBrowserMissingError();
    });
    const out = await executeRecipe(recipe(), { repo: "a/b" }, deps(runner));
    expect(out).toMatchObject({ kind: "error", code: EXIT.unavailable });
  });

  it("recipes that fail lint exit 65 before any browser call", async () => {
    const runner = new FakeBrowserRunner(evalReturns(JSON.stringify(GOOD)));
    const bad = recipe({ steps: [["open", "https://github.com/"], ["cookies", "set", "a", "b"], ["eval", "JSON.stringify({})"]] });
    const out = await executeRecipe(bad, {}, deps(runner));
    expect(out).toMatchObject({ kind: "error", code: EXIT.invalid });
    expect(runner.batches).toHaveLength(0);
  });

  it("bad params exit 64 before any browser call", async () => {
    const runner = new FakeBrowserRunner(evalReturns(JSON.stringify(GOOD)));
    const out = await executeRecipe(recipe(), { nope: "x" }, deps(runner));
    expect(out).toMatchObject({ kind: "error", code: EXIT.usage });
    expect(runner.batches).toHaveLength(0);
  });
});
