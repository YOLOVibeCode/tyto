import type { BatchStepResult, BrowserRunner } from "../ports/browser-runner.ts";
import type { SessionLock } from "../ports/session-lock.ts";
import { lintRecipe } from "../recipe/lint.ts";
import { renderRecipe } from "../recipe/render.ts";
import type { ParamValue, Recipe } from "../recipe/types.ts";
import { verifyResult } from "../recipe/verify.ts";
import { AgentBrowserMissingError } from "./errors.ts";
import { EXIT, type ExitCode } from "./exit.ts";
import { isLaunchError } from "./launch-error.ts";
import { replaySession, type ReplayPaths } from "./session.ts";

export type ExecDeps = { runner: BrowserRunner; lock: SessionLock; paths: ReplayPaths };

export type ExecOptions = { deadlineMs?: number; lockWaitMs?: number; actionTimeoutMs?: number };

export type ExecOutcome =
  | { kind: "hit"; result: Record<string, unknown>; params: Record<string, ParamValue> }
  | { kind: "miss"; miss: string; step: number }
  | { kind: "error"; code: ExitCode; message: string };

const DEFAULT_DEADLINE_MS = 15_000;
const DEFAULT_LOCK_WAIT_MS = 10_000;

function firstFailure(results: readonly BatchStepResult[]): { index: number; error: string | null } | null {
  const index = results.findIndex((r) => !r.success);
  return index < 0 ? null : { index, error: results[index]?.error ?? null };
}

function evalValue(step: BatchStepResult | undefined): unknown {
  const result = step?.result;
  return typeof result === "object" && result !== null && "result" in result ? (result as { result: unknown }).result : undefined;
}

/** Run a recipe with no model: lint → render → one batch → verify. */
export async function executeRecipe(
  recipe: Recipe,
  input: Readonly<Record<string, string>>,
  deps: ExecDeps,
  opts: ExecOptions = {},
): Promise<ExecOutcome> {
  const problems = lintRecipe(recipe);
  if (problems.length) return { kind: "error", code: EXIT.invalid, message: `recipe fails lint: ${problems.join("; ")}` };
  if (recipe.auth && recipe.status !== "approved") {
    return { kind: "error", code: EXIT.notApproved, message: `recipe ${recipe.name} uses your logins; approve it first (tyto recipes approve ${recipe.name})` };
  }
  const rendered = renderRecipe(recipe, input);
  if (!rendered.ok) return { kind: "error", code: EXIT.usage, message: rendered.error };

  const session = replaySession(recipe, deps.paths, opts.actionTimeoutMs);
  const release = await deps.lock.acquire(session.session, opts.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS);
  if (!release) return { kind: "error", code: EXIT.busy, message: `session ${session.session} is busy` };

  const signal = AbortSignal.timeout(opts.deadlineMs ?? DEFAULT_DEADLINE_MS);
  const runOpts = { session: session.session, args: session.args, env: session.env, signal };
  try {
    let results = await deps.runner.batch(rendered.steps, runOpts);
    let failure = firstFailure(results);
    if (failure && isLaunchError(failure.error)) {
      results = await deps.runner.batch(rendered.steps, runOpts);
      failure = firstFailure(results);
    }
    if (failure) {
      const cmd = rendered.steps[failure.index]?.[0] ?? "?";
      return { kind: "miss", miss: `${cmd} failed: ${failure.error ?? "unknown error"}`, step: failure.index + 1 };
    }
    if (results.length !== rendered.steps.length) {
      return { kind: "error", code: EXIT.internal, message: "agent-browser returned fewer results than steps" };
    }
    const verified = verifyResult(evalValue(results.at(-1)), recipe.verify, rendered.params);
    if (!verified.hit) return { kind: "miss", miss: verified.miss, step: rendered.steps.length };
    return { kind: "hit", result: verified.result, params: rendered.params };
  } catch (e) {
    if (e instanceof AgentBrowserMissingError) return { kind: "error", code: EXIT.unavailable, message: e.message };
    if (signal.aborted) return { kind: "error", code: EXIT.internal, message: "recipe exceeded its overall deadline" };
    return { kind: "error", code: EXIT.internal, message: e instanceof Error ? e.message : String(e) };
  } finally {
    await release();
  }
}
