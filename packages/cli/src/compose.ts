import { homedir } from "node:os";
import { join } from "node:path";
import { AgentBrowserRunner } from "@tyto/agent-browser";
import { SecretRedactor } from "@tyto/core";
import { FileLogMarks, FileSessionLock, FilesystemRecipeStore, ensureReplayFiles } from "@tyto/store";
import type { CliDeps } from "./main.ts";

/** Composition root: the only place real adapters are wired together. */
export async function composeDeps(env: NodeJS.ProcessEnv = process.env): Promise<CliDeps> {
  const home = env.TYTO_HOME && env.TYTO_HOME !== "" ? env.TYTO_HOME : join(homedir(), ".tyto");
  const paths = await ensureReplayFiles(home);
  const runner = new AgentBrowserRunner({ bin: env.TYTO_AGENT_BROWSER ?? "agent-browser" });
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
      redactor: new SecretRedactor(),
      session: env.AGENT_BROWSER_SESSION && env.AGENT_BROWSER_SESSION !== "" ? env.AGENT_BROWSER_SESSION : "default",
      now: () => Date.now(),
    },
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  };
}
