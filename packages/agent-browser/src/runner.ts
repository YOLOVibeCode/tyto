import { spawn } from "node:child_process";
import {
  AgentBrowserMissingError,
  BatchOutputError,
  type BatchStepResult,
  type BrowserRunner,
  type RunOptions,
  type RunOutput,
} from "@tyto/core";

export type AgentBrowserRunnerOptions = {
  /** Path or name of the agent-browser binary. Default: `agent-browser` on PATH. */
  bin?: string;
  baseEnv?: NodeJS.ProcessEnv;
  maxOutputBytes?: number;
};

const DEFAULT_MAX_OUTPUT = 64 * 1024 * 1024;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function withoutLifecycle(result: unknown): unknown {
  if (!isRecord(result) || !("lifecycle" in result)) return result;
  const { lifecycle: _lifecycle, ...rest } = result;
  return rest;
}

function toStepResult(raw: unknown): BatchStepResult {
  if (!isRecord(raw) || !Array.isArray(raw.command)) throw new BatchOutputError("batch output entry has no command");
  const error = raw.error;
  return {
    command: raw.command.map(String),
    success: raw.success === true,
    result: withoutLifecycle(raw.result),
    error: error === null || error === undefined ? null : typeof error === "string" ? error : JSON.stringify(error),
  };
}

/** Runs the agent-browser CLI with an argv array (never a shell string). */
export class AgentBrowserRunner implements BrowserRunner {
  readonly #bin: string;
  readonly #baseEnv: NodeJS.ProcessEnv;
  readonly #maxOutput: number;

  constructor(opts: AgentBrowserRunnerOptions = {}) {
    this.#bin = opts.bin ?? "agent-browser";
    this.#baseEnv = opts.baseEnv ?? process.env;
    this.#maxOutput = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
  }

  run(argv: readonly string[], opts: RunOptions): Promise<RunOutput> {
    return this.#exec([...this.#prefix(opts), ...argv], opts, undefined);
  }

  async batch(steps: readonly (readonly string[])[], opts: RunOptions): Promise<BatchStepResult[]> {
    const out = await this.#exec([...this.#prefix(opts), "batch", "--bail", "--json"], opts, JSON.stringify(steps));
    let parsed: unknown;
    try {
      parsed = JSON.parse(out.stdout);
    } catch {
      throw new BatchOutputError(`agent-browser batch did not print JSON: ${out.stderr.trim().slice(0, 300)}`);
    }
    if (!Array.isArray(parsed)) throw new BatchOutputError("agent-browser batch output is not an array");
    return parsed.map(toStepResult);
  }

  #prefix(opts: RunOptions): string[] {
    return ["--session", opts.session, ...(opts.args ?? [])];
  }

  #exec(args: readonly string[], opts: RunOptions, stdin: string | undefined): Promise<RunOutput> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.#bin, args, {
        env: { ...this.#baseEnv, ...(opts.env ?? {}) },
        stdio: ["pipe", "pipe", "pipe"],
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      let stdout = "";
      let stderr = "";
      let size = 0;
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        size += chunk.length;
        if (size > this.#maxOutput) child.kill("SIGKILL");
        else stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        if (stderr.length < 65_536) stderr += chunk;
      });
      child.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT" || err.code === "EACCES") reject(new AgentBrowserMissingError(`agent-browser not found at ${this.#bin}`));
        else reject(err);
      });
      child.on("close", (code) => {
        if (opts.signal?.aborted) reject(opts.signal.reason instanceof Error ? opts.signal.reason : new Error("aborted"));
        else if (size > this.#maxOutput) reject(new BatchOutputError("agent-browser output exceeded the size limit"));
        else resolve({ exitCode: code ?? 1, stdout, stderr });
      });
      child.stdin.on("error", () => {
        // The child may exit before reading stdin (e.g. missing binary); `error`/`close` report the outcome.
      });
      child.stdin.end(stdin ?? "");
    });
  }
}
