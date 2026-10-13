import { describe, expect, it } from "vitest";
import { AgentBrowserMissingError, BATCH_LANES, EXIT, parseBatchInputs, parseRecipe, runBatch, type BatchLine, type Recipe } from "../src/index.ts";
import { FakeBrowserRunner, FakeSessionLock, evalReturns, stepFails, type BatchScript } from "../src/testing/index.ts";

const PATHS = { config: "/tmp/tyto/agent-browser.json", policy: "/tmp/tyto/policy.json" };

function recipe(overrides: Record<string, unknown> = {}): Recipe {
  const parsed = parseRecipe({
    name: "release",
    version: 1,
    status: "draft",
    auth: false,
    intent: "Newest release tag.",
    examples: [],
    origins: ["https://github.com"],
    params: { repo: { type: "string", description: "owner/name", example: "a/b" } },
    steps: [
      ["open", "https://github.com/{{repo|path}}/releases"],
      ["eval", "JSON.stringify({ tag: 'v1', repo: params.repo })"],
    ],
    verify: { required: ["tag", "repo"] },
    ...overrides,
  });
  if (!parsed.ok) throw new Error(parsed.errors.join("; "));
  return parsed.recipe;
}

/** The eval returns the repo the batch rendered, so each line can be checked against its input. */
const echoRepo: BatchScript = (steps) => {
  const repo = /github\.com\/(.+)\/releases/.exec(steps[0]?.[1] ?? "")?.[1] ?? "";
  return evalReturns(JSON.stringify({ tag: "v1", repo }))(steps, { session: "" });
};

const inputs = (...repos: string[]) => repos.map((repo) => ({ repo }));

function collect() {
  const lines: BatchLine[] = [];
  return { lines, onLine: (line: BatchLine) => lines.push(line) };
}

function deps(runner: FakeBrowserRunner, lock = new FakeSessionLock()) {
  return { runner, lock, paths: PATHS };
}

describe("parseBatchInputs", () => {
  it("reads one JSON object of param values per line and skips blank lines", () => {
    const parsed = parseBatchInputs('{"repo":"a/b"}\n\n{"repo":"c/d","n":2}\n');
    expect(parsed).toEqual({ ok: true, inputs: [{ repo: "a/b" }, { repo: "c/d", n: "2" }] });
  });

  it("names the line of anything that is not an object of strings or numbers", () => {
    expect(parseBatchInputs('{"repo":"a/b"}\n["c/d"]\n')).toEqual({ ok: false, error: "line 2: expected a JSON object of param values" });
    expect(parseBatchInputs('{"repo":"a/b"}\n{"repo":{"x":1}}\n')).toEqual({ ok: false, error: "line 2: repo must be a string or a number" });
    expect(parseBatchInputs("{nope\n")).toEqual({ ok: false, error: "line 1: not JSON" });
  });

  it("refuses an empty file", () => {
    expect(parseBatchInputs("\n \n")).toEqual({ ok: false, error: "no inputs: give one JSON object per line" });
  });
});

describe("runBatch", () => {
  it("runs public inputs in lanes tyto-rx-1 … tyto-rx-N with the recipe's allowlist, never in tyto-rx", async () => {
    const runner = new FakeBrowserRunner(echoRepo);
    const out = collect();
    await runBatch(recipe(), inputs("a/1", "a/2", "a/3", "a/4"), deps(runner), { concurrency: 3, onLine: out.onLine });
    const sessions = new Set(runner.batches.map((b) => b.opts.session));
    expect([...sessions].sort()).toEqual(["tyto-rx-1", "tyto-rx-2", "tyto-rx-3"]);
    for (const b of runner.batches) expect(b.opts.args).toEqual(["--allowed-domains", "github.com", "--action-policy", PATHS.policy]);
  });

  it("never runs more inputs at once than the concurrency", async () => {
    let inFlight = 0;
    let most = 0;
    const slow: BatchScript = async (steps, opts) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return echoRepo(steps, opts);
    };
    await runBatch(recipe(), inputs("a/1", "a/2", "a/3", "a/4", "a/5", "a/6", "a/7"), deps(new FakeBrowserRunner(slow)), { concurrency: 3, onLine: () => undefined });
    expect(most).toBe(3);
  });

  it("prints one line per input in input order, even when later inputs finish first", async () => {
    const lagFirst: BatchScript = async (steps, opts) => {
      if (steps[0]?.[1]?.includes("a/1")) await new Promise((resolve) => setTimeout(resolve, 20));
      return echoRepo(steps, opts);
    };
    const out = collect();
    await runBatch(recipe(), inputs("a/1", "a/2", "a/3"), deps(new FakeBrowserRunner(lagFirst)), { concurrency: 3, onLine: out.onLine });
    expect(out.lines.map((l) => [l.index, l.input])).toEqual([
      [0, { repo: "a/1" }],
      [1, { repo: "a/2" }],
      [2, { repo: "a/3" }],
    ]);
  });

  it("a hit line carries the verified result and a miss line the miss and step; exit 3 when any input misses", async () => {
    const missSecond: BatchScript = (steps, opts) => (steps[0]?.[1]?.includes("a/2") ? stepFails(0, "net::ERR_NAME_NOT_RESOLVED")(steps, opts) : echoRepo(steps, opts));
    const out = collect();
    const outcome = await runBatch(recipe(), inputs("a/1", "a/2"), deps(new FakeBrowserRunner(missSecond)), { concurrency: 2, onLine: out.onLine });
    expect(out.lines[0]).toEqual({ index: 0, input: { repo: "a/1" }, hit: true, result: { tag: "v1", repo: "a/1" } });
    expect(out.lines[1]).toEqual({ index: 1, input: { repo: "a/2" }, hit: false, miss: "open failed: net::ERR_NAME_NOT_RESOLVED", step: 1 });
    expect(outcome).toMatchObject({ kind: "done", code: EXIT.miss, hits: 1, misses: 1, errors: 0 });
  });

  it("exits 0 when every input hits and returns their params for the regression cases", async () => {
    const outcome = await runBatch(recipe(), inputs("a/1", "a/2"), deps(new FakeBrowserRunner(echoRepo)), { concurrency: 2, onLine: () => undefined });
    expect(outcome).toMatchObject({ kind: "done", code: EXIT.hit, hits: 2, misses: 0, errors: 0, passed: [{ repo: "a/1" }, { repo: "a/2" }] });
  });

  it("recipes that fail lint exit 65 and bad params exit 64 before any browser call", async () => {
    const runner = new FakeBrowserRunner(echoRepo);
    const lint = await runBatch(recipe({ steps: [["open", "https://evil.example/x"], ["eval", "JSON.stringify({})"]] }), inputs("a/1"), deps(runner), { concurrency: 2, onLine: () => undefined });
    const params = await runBatch(recipe(), [{ repo: "a/1" }, {}], deps(runner), { concurrency: 2, onLine: () => undefined });
    expect(lint).toMatchObject({ kind: "error", code: EXIT.invalid });
    expect(params).toMatchObject({ kind: "error", code: EXIT.usage, message: expect.stringMatching(/^input at index 1: /) });
    expect(runner.batches).toHaveLength(0);
  });

  it("takes free lanes only: a lane another batch holds is skipped", async () => {
    const lock = new FakeSessionLock();
    lock.held.add("tyto-rx-1");
    const runner = new FakeBrowserRunner(echoRepo);
    await runBatch(recipe(), inputs("a/1", "a/2"), deps(runner, lock), { concurrency: 2, onLine: () => undefined });
    expect([...new Set(runner.batches.map((b) => b.opts.session))].sort()).toEqual(["tyto-rx-2", "tyto-rx-3"]);
  });

  it("exits 75 before any browser call when every lane is busy", async () => {
    const lock = new FakeSessionLock();
    for (let lane = 1; lane <= BATCH_LANES; lane += 1) lock.held.add(`tyto-rx-${lane}`);
    const runner = new FakeBrowserRunner(echoRepo);
    const outcome = await runBatch(recipe(), inputs("a/1"), deps(runner, lock), { concurrency: 2, onLine: () => undefined });
    expect(outcome).toMatchObject({ kind: "error", code: EXIT.busy });
    expect(runner.batches).toHaveLength(0);
  });

  it("an auth recipe runs one input at a time in tyto-rx-auth, and only when approved", async () => {
    const draft = await runBatch(recipe({ auth: true }), inputs("a/1"), deps(new FakeBrowserRunner(echoRepo)), { concurrency: 4, onLine: () => undefined });
    expect(draft).toMatchObject({ kind: "error", code: EXIT.notApproved });

    let inFlight = 0;
    let most = 0;
    const slow: BatchScript = async (steps, opts) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return echoRepo(steps, opts);
    };
    const runner = new FakeBrowserRunner(slow);
    const outcome = await runBatch(recipe({ auth: true, status: "approved" }), inputs("a/1", "a/2", "a/3"), deps(runner), { concurrency: 4, onLine: () => undefined });
    expect(outcome).toMatchObject({ kind: "done", code: EXIT.hit, lanes: ["tyto-rx-auth"] });
    expect(most).toBe(1);
    expect(new Set(runner.batches.map((b) => b.opts.session))).toEqual(new Set(["tyto-rx-auth"]));
  });

  it("closes its lanes with Tyto's config when the batch ends and releases their locks", async () => {
    const lock = new FakeSessionLock();
    const runner = new FakeBrowserRunner(echoRepo);
    await runBatch(recipe(), inputs("a/1", "a/2"), deps(runner, lock), { concurrency: 2, onLine: () => undefined });
    expect(runner.runs.map((r) => [r.argv, r.opts.session, r.opts.env?.AGENT_BROWSER_CONFIG])).toEqual([
      [["close"], "tyto-rx-1", PATHS.config],
      [["close"], "tyto-rx-2", PATHS.config],
    ]);
    expect(lock.held.size).toBe(0);
  });

  it("keeps tyto-rx-auth open after an auth batch, as a single run does", async () => {
    const runner = new FakeBrowserRunner(echoRepo);
    await runBatch(recipe({ auth: true, status: "approved" }), inputs("a/1"), deps(runner), { concurrency: 1, onLine: () => undefined });
    expect(runner.runs).toHaveLength(0);
  });

  it("a missing agent-browser stops the batch: inputs not yet run are reported, exit 69", async () => {
    const runner = new FakeBrowserRunner(() => {
      throw new AgentBrowserMissingError();
    });
    const out = collect();
    const outcome = await runBatch(recipe(), inputs("a/1", "a/2", "a/3"), deps(runner), { concurrency: 1, onLine: out.onLine });
    expect(outcome).toMatchObject({ kind: "done", code: EXIT.unavailable, errors: 3 });
    expect(runner.batches).toHaveLength(1);
    expect(out.lines.map((l) => ("code" in l ? l.code : null))).toEqual([EXIT.unavailable, EXIT.unavailable, EXIT.unavailable]);
    expect(out.lines[2]).toMatchObject({ error: "not run: agent-browser is not installed or not on PATH" });
  });
});
