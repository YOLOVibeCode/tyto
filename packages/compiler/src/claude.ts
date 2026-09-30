import { spawn } from "node:child_process";
import { join } from "node:path";
import type { CompileRequest, Compiler } from "@tyto/core";
import { prepareWorkdir } from "./workdir.ts";

export type ClaudeCodeCompilerOptions = {
  /** Path to the Tyto CLI entry (bin/tyto.mjs); exposed to the model as `tyto` on PATH. */
  tytoBin: string;
  /** Parent directory for per-compile work folders (drafts, context). */
  workRoot: string;
  claudeBin?: string;
  model?: string;
  maxTurns?: number;
  timeoutMs?: number;
  baseEnv?: NodeJS.ProcessEnv;
};

const DENIED = ["Write", "Edit", "NotebookEdit", "WebFetch", "WebSearch", "Task"];
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

/** Runs `claude -p` (Claude Code headless, the user's Max plan) with `tyto compile-tool` as its only tool. */
export class ClaudeCodeCompiler implements Compiler {
  readonly #opts: ClaudeCodeCompilerOptions;

  constructor(opts: ClaudeCodeCompilerOptions) {
    this.#opts = opts;
  }

  async run(req: CompileRequest): Promise<string> {
    const dir = await prepareWorkdir(this.#opts.workRoot, req.context, this.#opts.tytoBin, process.execPath);
    const { ANTHROPIC_API_KEY: _key, ...base } = this.#opts.baseEnv ?? process.env;
    const env = { ...base, PATH: `${join(dir, "bin")}:${base.PATH ?? ""}`, TYTO_COMPILE_DIR: dir };
    const args = [
      "-p", req.prompt,
      "--model", this.#opts.model ?? "sonnet",
      "--output-format", "json",
      "--append-system-prompt", req.system,
      "--allowedTools", "Bash(tyto compile-tool:*)",
      "--disallowedTools", ...DENIED,
      "--strict-mcp-config",
      "--no-session-persistence",
      "--max-turns", String(this.#opts.maxTurns ?? 40),
    ];
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(this.#opts.claudeBin ?? "claude", args, {
        cwd: dir,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        signal: AbortSignal.timeout(this.#opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      let out = "";
      let err = "";
      child.stdout.setEncoding("utf8").on("data", (c: string) => (out += c));
      child.stderr.setEncoding("utf8").on("data", (c: string) => {
        if (err.length < 10_000) err += c;
      });
      child.on("error", (e: NodeJS.ErrnoException) =>
        reject(new Error(e.code === "ENOENT" ? "compiler: claude (Claude Code) is not installed" : `compiler: ${e.message}`)),
      );
      child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`compiler: claude exited ${code}: ${(err || out).slice(0, 300)}`))));
    });
    let parsed: { is_error?: boolean; result?: unknown };
    try {
      parsed = JSON.parse(stdout) as { is_error?: boolean; result?: unknown };
    } catch {
      throw new Error("compiler: claude did not print JSON");
    }
    if (parsed.is_error || typeof parsed.result !== "string") throw new Error(`compiler: ${String(parsed.result ?? "no result")}`);
    return parsed.result;
  }
}
