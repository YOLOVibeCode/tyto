import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { AgentBrowserRunner, StreamEventSource, agentBrowserSocketDir } from "@tyto/agent-browser";
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter } from "node:path";
import { promisify } from "node:util";
import type { TytoSession } from "./doctor.ts";
import { ClaudeCodeCompiler, OpenAiCompatCompiler } from "@tyto/compiler";
import type { Compiler } from "@tyto/core";
import { createInterface } from "node:readline/promises";
import { text } from "node:stream/consumers";
import { Recorder, SecretRedactor } from "@tyto/core";
import { FileLogMarks, FileSessionLock, FileTraceStore, FilesystemRecipeStore, ensureReplayFiles } from "@tyto/store";
import { requestControl, serveControl } from "./learn/control.ts";
import { runListener } from "./learn/listener.ts";

const run = promisify(execFile);
const TYTO_SESSIONS = ["tyto-rx", "tyto-rx-auth", "tyto-compile"];

async function versionOf(bin: string): Promise<string | null> {
  try {
    const { stdout } = await run(bin, ["--version"], { timeout: 10_000 });
    return /(\d+\.\d+\.\d+)/.exec(stdout)?.[1] ?? null;
  } catch {
    return null;
  }
}

async function onPath(name: string, pathVar: string | undefined): Promise<string | null> {
  for (const dir of (pathVar ?? "").split(delimiter).filter(Boolean)) {
    const candidate = join(dir, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

async function runningSessions(env: NodeJS.ProcessEnv): Promise<TytoSession[]> {
  const dir = agentBrowserSocketDir(env);
  const out: TytoSession[] = [];
  for (const session of TYTO_SESSIONS) {
    const pid = Number((await readFile(join(dir, `${session}.pid`), "utf8").catch(() => "")).trim());
    if (!pid) continue;
    try {
      process.kill(pid, 0);
    } catch {
      continue;
    }
    const version = (await readFile(join(dir, `${session}.version`), "utf8").catch(() => "")).trim() || null;
    out.push({ session, pid, version });
  }
  return out;
}

/** TYTO_COMPILER=claude (default: Claude Code headless) or openai (TYTO_BASE_URL, TYTO_MODEL, optional TYTO_API_KEY). */
export function selectCompiler(env: NodeJS.ProcessEnv, opts: { tytoBin: string; workRoot: string }): Compiler {
  const which = env.TYTO_COMPILER && env.TYTO_COMPILER !== "" ? env.TYTO_COMPILER : "claude";
  if (which === "claude") return new ClaudeCodeCompiler({ ...opts, model: env.TYTO_COMPILER_MODEL ?? "sonnet", baseEnv: env });
  if (which === "openai") {
    if (!env.TYTO_BASE_URL) throw new Error("TYTO_COMPILER=openai needs TYTO_BASE_URL (e.g. http://127.0.0.1:11434/v1)");
    if (!env.TYTO_MODEL) throw new Error("TYTO_COMPILER=openai needs TYTO_MODEL");
    return new OpenAiCompatCompiler({ ...opts, baseUrl: new URL(env.TYTO_BASE_URL), apiKey: env.TYTO_API_KEY ?? "", model: env.TYTO_MODEL, baseEnv: env });
  }
  throw new Error(`TYTO_COMPILER must be claude or openai, not ${which}`);
}

const BIN = fileURLToPath(new URL("../bin/tyto.mjs", import.meta.url));
const LISTEN_MAX_MS = 2 * 60 * 60 * 1000;
import type { CliDeps } from "./main.ts";

/** Composition root: the only place real adapters are wired together. */
export async function composeDeps(env: NodeJS.ProcessEnv = process.env): Promise<CliDeps> {
  const home = env.TYTO_HOME && env.TYTO_HOME !== "" ? env.TYTO_HOME : join(homedir(), ".tyto");
  const paths = await ensureReplayFiles(home);
  const runner = new AgentBrowserRunner({ bin: env.TYTO_AGENT_BROWSER ?? "agent-browser" });
  const redactor = new SecretRedactor();
  const socket = (name: string): string => join(home, "learn", `${name}.sock`);
  return {
    store: new FilesystemRecipeStore(join(home, "recipes")),
    exec: {
      runner,
      lock: new FileSessionLock(join(home, "locks")),
      paths,
    },
    browse: {
      runner,
      marks: new FileLogMarks(join(home, "marks")),
      redactor,
      session: env.AGENT_BROWSER_SESSION && env.AGENT_BROWSER_SESSION !== "" ? env.AGENT_BROWSER_SESSION : "default",
      now: () => Date.now(),
    },
    learn: {
      spawnListener: async (name, session) => {
        const child = spawn(process.execPath, [BIN, "learn", "--listen", name, "--session", session], { detached: true, stdio: "ignore", env });
        child.unref();
      },
      control: (name, req) => requestControl(socket(name), req),
      listen: async (name, session) => {
        await runListener(name, session, {
          recorder: new Recorder({ events: new StreamEventSource(), runner }),
          traces: new FileTraceStore(join(home, "traces")),
          redactor,
          now: () => Date.now(),
          serve: (handler) => serveControl(socket(name), handler),
          tracePath: (n) => join(home, "traces", `${n}.json`),
          maxMs: LISTEN_MAX_MS,
        });
        return 0;
      },
    },
    traces: new FileTraceStore(join(home, "traces")),
    // Resolved on use, so a misconfigured compiler only affects `tyto compile` and `tyto repair`.
    compiler: { run: (req) => selectCompiler(env, { tytoBin: BIN, workRoot: join(home, "compile") }).run(req) },
    compileTool: {
      dir: env.TYTO_COMPILE_DIR && env.TYTO_COMPILE_DIR !== "" ? env.TYTO_COMPILE_DIR : undefined,
      readStdin: () => text(process.stdin),
    },
    confirm: async (question) => {
      if (!process.stdin.isTTY) return false;
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return /^y(es)?$/i.test((await rl.question(question)).trim());
      } finally {
        rl.close();
      }
    },
    setup: {
      install: { home: homedir(), binDir: join(homedir(), ".local", "bin"), nodePath: process.execPath, cliBin: BIN },
      doctor: {
        nodeVersion: process.versions.node,
        agentBrowserVersion: () => versionOf(env.TYTO_AGENT_BROWSER ?? "agent-browser"),
        claudeVersion: () => versionOf("claude"),
        launcher: () => onPath("tyto", env.PATH),
        sessions: () => runningSessions(env),
        closeSession: async (session) => {
          await runner.run(["close"], { session });
        },
      },
    },
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  };
}
