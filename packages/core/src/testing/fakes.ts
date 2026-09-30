import type { BatchStepResult, BrowserRunner, RunOptions, RunOutput } from "../ports/browser-runner.ts";
import type { RecipeStore, RecipeSummary } from "../ports/recipe-store.ts";
import type { Release, SessionLock } from "../ports/session-lock.ts";
import type { Recipe } from "../recipe/types.ts";
import type { LogCounts } from "../brief/types.ts";
import type { LogMarks } from "../ports/log-marks.ts";
import type { BrowserEventSource } from "../ports/browser-events.ts";
import type { TraceStore } from "../ports/trace-store.ts";
import type { StreamEvent, Trace } from "../trace/types.ts";
import type { CompileRequest, Compiler } from "../ports/compiler.ts";
import type { Clock } from "../ports/clock.ts";
import type { ModelPort } from "../ports/model.ts";
import type { CompleteRequest, CompleteResponse } from "../types.ts";

export class FakeClock implements Clock {
  t = 0;
  sleeps = 0;
  private waiters: Array<{ due: number; resolve: () => void }> = [];

  now(): number {
    return this.t;
  }

  async sleep(ms: number): Promise<void> {
    this.sleeps += 1;
    const due = this.t + ms;
    if (due <= this.t) return;
    return new Promise((resolve) => {
      this.waiters.push({ due, resolve });
    });
  }

  /** Resolve pending `sleep` waiters whose due time has been reached. */
  advance(ms: number): void {
    this.t += ms;
    const ready = this.waiters.filter((w) => w.due <= this.t);
    this.waiters = this.waiters.filter((w) => w.due > this.t);
    for (const w of ready) w.resolve();
  }
}

export class FakeModel implements ModelPort {
  calls = 0;
  last?: CompleteRequest;
  canned: CompleteResponse = { text: "ok" };
  async complete(req: CompleteRequest): Promise<CompleteResponse> {
    this.calls += 1;
    this.last = req;
    return this.canned;
  }
}


export type BatchScript = (steps: readonly (readonly string[])[], opts: RunOptions) => BatchStepResult[] | Promise<BatchStepResult[]>;

/** Scripted agent-browser. Each batch call takes the next script; the last one repeats. */
export class FakeBrowserRunner implements BrowserRunner {
  readonly batches: Array<{ steps: readonly (readonly string[])[]; opts: RunOptions }> = [];
  readonly runs: Array<{ argv: readonly string[]; opts: RunOptions }> = [];
  private scripts: BatchScript[];
  runOutput: RunOutput = { exitCode: 0, stdout: "", stderr: "" };
  /** Optional per-call answer for `run`; falls back to `runOutput`. */
  onRun?: (argv: readonly string[], opts: RunOptions) => RunOutput;

  constructor(...scripts: BatchScript[]) {
    this.scripts = scripts;
  }

  async run(argv: readonly string[], opts: RunOptions): Promise<RunOutput> {
    this.runs.push({ argv, opts });
    return this.onRun ? this.onRun(argv, opts) : this.runOutput;
  }

  async batch(steps: readonly (readonly string[])[], opts: RunOptions): Promise<BatchStepResult[]> {
    this.batches.push({ steps, opts });
    const script = this.scripts.length > 1 ? this.scripts.shift() : this.scripts[0];
    if (!script) throw new Error("FakeBrowserRunner: no script");
    return script(steps, opts);
  }
}

/** Every step succeeds; the final eval returns `value`. */
export function evalReturns(value: unknown): BatchScript {
  return (steps) =>
    steps.map((command, i) => ({
      command,
      success: true,
      result: i === steps.length - 1 ? { result: value } : {},
      error: null,
    }));
}

/** Steps succeed until `index`, which fails with `error` (`--bail` stops there). */
export function stepFails(index: number, error: string): BatchScript {
  return (steps) =>
    steps.slice(0, index + 1).map((command, i) => ({
      command,
      success: i !== index,
      result: {},
      error: i === index ? error : null,
    }));
}

export class MemoryRecipeStore implements RecipeStore {
  readonly recipes = new Map<string, Recipe>();

  constructor(...recipes: Recipe[]) {
    for (const r of recipes) this.recipes.set(r.name, r);
  }

  async get(name: string): Promise<Recipe | null> {
    return this.recipes.get(name) ?? null;
  }

  async list(): Promise<RecipeSummary[]> {
    return [...this.recipes.values()].map((r) => ({
      name: r.name,
      intent: r.intent,
      params: Object.keys(r.params),
      status: r.status,
      auth: r.auth,
    }));
  }

  async save(recipe: Recipe): Promise<void> {
    this.recipes.set(recipe.name, recipe);
  }

  async remove(name: string): Promise<boolean> {
    return this.recipes.delete(name);
  }
}

export class FakeSessionLock implements SessionLock {
  readonly held = new Set<string>();
  readonly acquired: string[] = [];
  busy = false;

  async acquire(session: string, _waitMs: number): Promise<Release | null> {
    if (this.busy || this.held.has(session)) return null;
    this.held.add(session);
    this.acquired.push(session);
    return async () => {
      this.held.delete(session);
    };
  }
}

export class MemoryLogMarks implements LogMarks {
  readonly marks = new Map<string, LogCounts>();

  async get(session: string): Promise<LogCounts> {
    return this.marks.get(session) ?? { console: 0, errors: 0, requests: 0 };
  }

  async set(session: string, counts: LogCounts): Promise<void> {
    this.marks.set(session, counts);
  }
}

/** Push-driven event stream for tests. `emit` delivers to the current subscriber. */
export class FakeEventSource implements BrowserEventSource {
  private queue: StreamEvent[] = [];
  private wake: (() => void) | null = null;
  subscribed: string[] = [];

  emit(...events: StreamEvent[]): void {
    this.queue.push(...events);
    this.wake?.();
  }

  async *subscribe(session: string, signal: AbortSignal): AsyncIterable<StreamEvent> {
    this.subscribed.push(session);
    while (!signal.aborted) {
      const next = this.queue.shift();
      if (next) {
        yield next;
        if (next.type === "closed") return;
        continue;
      }
      await new Promise<void>((resolve) => {
        this.wake = resolve;
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      this.wake = null;
    }
  }
}

export class MemoryTraceStore implements TraceStore {
  readonly traces = new Map<string, Trace>();

  async save(trace: Trace): Promise<void> {
    this.traces.set(trace.name, trace);
  }

  async get(name: string): Promise<Trace | null> {
    return this.traces.get(name) ?? null;
  }
}

export class FakeCompiler implements Compiler {
  readonly requests: CompileRequest[] = [];
  reply: string;

  constructor(reply = "") {
    this.reply = reply;
  }

  async run(req: CompileRequest): Promise<string> {
    this.requests.push(req);
    return this.reply;
  }
}
