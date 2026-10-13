import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { AgentBrowserRunner, StreamEventSource } from "@tyto/agent-browser";
import { Recorder, SecretRedactor } from "@tyto/core";
import { FileLogMarks, FileSessionLock, FileTraceStore, FilesystemRecipeStore, ensureReplayFiles } from "@tyto/store";
import { requestControl, serveControl } from "./learn/control.ts";
import { runListener } from "./learn/listener.ts";

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
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  };
}
