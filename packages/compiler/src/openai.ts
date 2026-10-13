import { spawn } from "node:child_process";
import type { CompileRequest, Compiler } from "@tyto/core";
import { chatWithTools, type ChatMessage, type ToolSpec } from "@tyto/llm";
import { prepareWorkdir, splitArgs } from "./workdir.ts";

export type OpenAiCompatCompilerOptions = {
  baseUrl: URL;
  apiKey: string;
  model: string;
  /** Path to bin/tyto.mjs; each tool call runs `node <tytoBin> compile-tool …`. */
  tytoBin: string;
  workRoot: string;
  nodePath?: string;
  maxTurns?: number;
  timeoutMs?: number;
  toolTimeoutMs?: number;
  baseEnv?: NodeJS.ProcessEnv;
};

const OUTPUT_LIMIT = 8000;

const TOOL: ToolSpec = {
  type: "function",
  function: {
    name: "tyto_compile_tool",
    description:
      "Run `tyto compile-tool <args>`. draft: pass the recipe JSON as stdin; test <draft id> --param value: run a draft with no model; ab <agent-browser args>: probe live pages.",
    parameters: {
      type: "object",
      properties: {
        args: { type: "array", items: { type: "string" }, description: 'Arguments after `tyto compile-tool`, e.g. ["test", "d1", "--species", "Tiger"]' },
        stdin: { type: "string", description: "Recipe JSON (only for draft)" },
      },
      required: ["args"],
    },
  },
};

/** Compiles with any OpenAI-compatible model (Ollama, proxies). Its only tool runs `tyto compile-tool` — argv, no shell. */
export class OpenAiCompatCompiler implements Compiler {
  readonly #opts: OpenAiCompatCompilerOptions;

  constructor(opts: OpenAiCompatCompilerOptions) {
    this.#opts = opts;
  }

  async run(req: CompileRequest): Promise<string> {
    const nodePath = this.#opts.nodePath ?? process.execPath;
    const dir = await prepareWorkdir(this.#opts.workRoot, req.context, this.#opts.tytoBin, nodePath);
    const chat = {
      baseUrl: this.#opts.baseUrl,
      apiKey: this.#opts.apiKey,
      model: this.#opts.model,
      timeoutMs: this.#opts.timeoutMs ?? 300_000,
    };
    const messages: ChatMessage[] = [
      { role: "system", content: req.system },
      { role: "user", content: req.prompt },
    ];
    const maxTurns = this.#opts.maxTurns ?? 40;
    for (let turn = 0; turn < maxTurns; turn += 1) {
      const reply = await chatWithTools(chat, messages, [TOOL]);
      if (!reply.toolCalls.length) return reply.content;
      messages.push(reply.message);
      for (const call of reply.toolCalls) {
        const output = await this.#tool(call.arguments, dir, nodePath);
        messages.push({ role: "tool", tool_call_id: call.id, content: output });
      }
    }
    throw new Error("compiler: turn limit reached without a final recipe");
  }

  async #tool(rawArgs: string, dir: string, nodePath: string): Promise<string> {
    let parsed: { args?: unknown; stdin?: unknown };
    try {
      parsed = JSON.parse(rawArgs) as { args?: unknown; stdin?: unknown };
    } catch {
      return "error: tool arguments must be JSON like {\"args\": [\"test\", \"d1\"]}";
    }
    const argv = Array.isArray(parsed.args) ? parsed.args.map(String) : splitArgs(String(parsed.args ?? ""));
    const stdin = typeof parsed.stdin === "string" ? parsed.stdin : "";
    const { ANTHROPIC_API_KEY: _key, ...base } = this.#opts.baseEnv ?? process.env;
    return new Promise((resolve) => {
      const child = spawn(nodePath, [this.#opts.tytoBin, "compile-tool", ...argv], {
        env: { ...base, TYTO_COMPILE_DIR: dir },
        stdio: ["pipe", "pipe", "pipe"],
        signal: AbortSignal.timeout(this.#opts.toolTimeoutMs ?? 180_000),
      });
      let out = "";
      const add = (c: string): void => {
        if (out.length < OUTPUT_LIMIT) out += c;
      };
      child.stdout.setEncoding("utf8").on("data", add);
      child.stderr.setEncoding("utf8").on("data", add);
      child.on("error", (e) => resolve(`error: ${e.message}`));
      child.on("close", (code) => resolve(`${out.slice(0, OUTPUT_LIMIT)}\n(exit ${code ?? "?"})`));
      child.stdin.on("error", () => undefined);
      child.stdin.end(stdin);
    });
  }
}
