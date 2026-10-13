import type { Release, SessionLock } from "../ports/session-lock.ts";
import { lintRecipe } from "../recipe/lint.ts";
import { renderRecipe } from "../recipe/render.ts";
import type { ParamValue, Recipe } from "../recipe/types.ts";
import { DEFAULT_LOCK_WAIT_MS, executeRecipe, type ExecDeps, type ExecOptions, type ExecOutcome } from "./execute.ts";
import { EXIT, type ExitCode } from "./exit.ts";
import { replaySession } from "./session.ts";

/** Lanes a batch may use: `tyto-rx-1` … `tyto-rx-8`. Each is its own agent-browser session and browser. */
export const BATCH_LANES = 8;
export const DEFAULT_CONCURRENCY = 3;
export const MAX_BATCH_INPUTS = 10_000;

const CLOSE_MS = 10_000;

export type BatchInputs = { ok: true; inputs: Record<string, string>[] } | { ok: false; error: string };

/** JSON Lines: one object of param values (strings or numbers) per line; blank lines are skipped. */
export function parseBatchInputs(text: string): BatchInputs {
  const inputs: Record<string, string>[] = [];
  const lines = text.split(/\r?\n/);
  for (const [i, line] of lines.entries()) {
    if (line.trim() === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return { ok: false, error: `line ${i + 1}: not JSON` };
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, error: `line ${i + 1}: expected a JSON object of param values` };
    const input: Record<string, string> = {};
    for (const [key, v] of Object.entries(value)) {
      if (typeof v === "string") input[key] = v;
      else if (typeof v === "number" && Number.isFinite(v)) input[key] = String(v);
      else return { ok: false, error: `line ${i + 1}: ${key} must be a string or a number` };
    }
    inputs.push(input);
    if (inputs.length > MAX_BATCH_INPUTS) return { ok: false, error: `more than ${MAX_BATCH_INPUTS} inputs; split the file` };
  }
  if (!inputs.length) return { ok: false, error: "no inputs: give one JSON object per line" };
  return { ok: true, inputs };
}

export type BatchLine =
  | { index: number; input: Record<string, string>; hit: true; result: Record<string, unknown> }
  | { index: number; input: Record<string, string>; hit: false; miss: string; step: number }
  | { index: number; input: Record<string, string>; hit: false; error: string; code: ExitCode };

export type BatchOptions = {
  /** Inputs run at once, one lane each; auth recipes always run one at a time. */
  concurrency: number;
  /** Called once per input, in input order. */
  onLine: (line: BatchLine) => void;
  exec?: ExecOptions;
};

export type BatchOutcome =
  | { kind: "error"; code: ExitCode; message: string }
  | {
      kind: "done";
      /** 0 every input hit · 3 some missed, none failed · otherwise the code of the first input that failed. */
      code: ExitCode;
      hits: number;
      misses: number;
      errors: number;
      lanes: readonly string[];
      /** Rendered params of the inputs that hit, in input order. */
      passed: Record<string, ParamValue>[];
    };

/** A lock for a lane the batch already holds: the executor's acquire succeeds for that session only. */
function heldLock(session: string): SessionLock {
  return { acquire: async (s) => (s === session ? async () => undefined : null) };
}

function lineFor(index: number, input: Record<string, string>, outcome: ExecOutcome): BatchLine {
  switch (outcome.kind) {
    case "hit":
      return { index, input, hit: true, result: outcome.result };
    case "miss":
      return { index, input, hit: false, miss: outcome.miss, step: outcome.step };
    case "error":
      return { index, input, hit: false, error: outcome.message, code: outcome.code };
    default: {
      const never: never = outcome;
      return never;
    }
  }
}

/** Free lanes for this batch, taken without waiting so two batches share the pool instead of queueing. */
async function takeLanes(recipe: Recipe, deps: ExecDeps, want: number, opts: ExecOptions): Promise<{ lane: number | undefined; session: string; release: Release }[]> {
  if (recipe.auth) {
    const session = replaySession(recipe, deps.paths).session;
    const release = await deps.lock.acquire(session, opts.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS);
    return release ? [{ lane: undefined, session, release }] : [];
  }
  const taken: { lane: number | undefined; session: string; release: Release }[] = [];
  for (let lane = 1; lane <= BATCH_LANES && taken.length < want; lane += 1) {
    const session = replaySession(recipe, deps.paths, undefined, lane).session;
    const release = await deps.lock.acquire(session, 0);
    if (release) taken.push({ lane, session, release });
  }
  return taken;
}

/**
 * Replay one recipe over many inputs with no model: lint, approval, and every input's params are checked before
 * any browser call; then each lane takes the next input until none are left. Lines come out in input order.
 * Public lanes are closed (with Tyto's config) when the batch ends; `tyto-rx` and `tyto-rx-auth` stay warm.
 */
export async function runBatch(recipe: Recipe, inputs: readonly Record<string, string>[], deps: ExecDeps, opts: BatchOptions): Promise<BatchOutcome> {
  const problems = lintRecipe(recipe);
  if (problems.length) return { kind: "error", code: EXIT.invalid, message: `recipe fails lint: ${problems.join("; ")}` };
  if (recipe.auth && recipe.status !== "approved") {
    return { kind: "error", code: EXIT.notApproved, message: `recipe ${recipe.name} uses your logins; approve it first (tyto recipes approve ${recipe.name})` };
  }
  for (const [index, input] of inputs.entries()) {
    const rendered = renderRecipe(recipe, input);
    if (!rendered.ok) return { kind: "error", code: EXIT.usage, message: `input at index ${index}: ${rendered.error}` };
  }

  const exec = opts.exec ?? {};
  const want = Math.max(1, Math.min(opts.concurrency, inputs.length, BATCH_LANES));
  const lanes = await takeLanes(recipe, deps, want, exec);
  if (!lanes.length) {
    const message = recipe.auth ? "session tyto-rx-auth is busy" : `all ${BATCH_LANES} batch lanes (tyto-rx-1 … tyto-rx-${BATCH_LANES}) are busy`;
    return { kind: "error", code: EXIT.busy, message };
  }

  const lines: (BatchLine | undefined)[] = new Array(inputs.length);
  const passed: (Record<string, ParamValue> | undefined)[] = new Array(inputs.length);
  let emitted = 0;
  const flush = (): void => {
    for (let line = lines[emitted]; line !== undefined; line = lines[emitted]) {
      opts.onLine(line);
      emitted += 1;
    }
  };

  let next = 0;
  let stopped: string | null = null;
  const work = async (lane: number | undefined, session: string): Promise<void> => {
    for (;;) {
      if (stopped !== null || next >= inputs.length) return;
      const index = next;
      next += 1;
      const input = inputs[index] ?? {};
      const outcome = await executeRecipe(recipe, input, { ...deps, lock: heldLock(session) }, lane === undefined ? exec : { ...exec, lane });
      if (outcome.kind === "hit") passed[index] = outcome.params;
      if (outcome.kind === "error" && outcome.code === EXIT.unavailable) stopped = outcome.message;
      lines[index] = lineFor(index, input, outcome);
      flush();
    }
  };

  try {
    await Promise.all(lanes.map((l) => work(l.lane, l.session)));
  } finally {
    for (const l of lanes) {
      if (l.lane !== undefined) {
        const env = replaySession(recipe, deps.paths, exec.actionTimeoutMs, l.lane).env;
        await deps.runner.run(["close"], { session: l.session, env, signal: AbortSignal.timeout(CLOSE_MS) }).catch(() => undefined);
      }
      await l.release();
    }
  }

  for (let index = next; index < inputs.length; index += 1) {
    lines[index] = { index, input: inputs[index] ?? {}, hit: false, error: `not run: ${stopped ?? "the batch stopped"}`, code: EXIT.unavailable };
  }
  flush();

  const all = lines.filter((l): l is BatchLine => l !== undefined);
  const hits = all.filter((l) => l.hit).length;
  const misses = all.filter((l) => "miss" in l).length;
  const failed = all.filter((l): l is Extract<BatchLine, { code: ExitCode }> => "code" in l);
  const code = failed[0]?.code ?? (misses ? EXIT.miss : EXIT.hit);
  return {
    kind: "done",
    code,
    hits,
    misses,
    errors: failed.length,
    lanes: lanes.map((l) => l.session),
    passed: passed.filter((p): p is Record<string, ParamValue> => p !== undefined),
  };
}
