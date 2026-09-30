import { homedir } from "node:os";
import { join } from "node:path";
import { AgentBrowserRunner } from "@tyto/agent-browser";
import { FileSessionLock, FilesystemRecipeStore, ensureReplayFiles } from "@tyto/store";
import type { CliDeps } from "./main.ts";

/** Composition root: the only place real adapters are wired together. */
export async function composeDeps(env: NodeJS.ProcessEnv = process.env): Promise<CliDeps> {
  const home = env.TYTO_HOME && env.TYTO_HOME !== "" ? env.TYTO_HOME : join(homedir(), ".tyto");
  const paths = await ensureReplayFiles(home);
  return {
    store: new FilesystemRecipeStore(join(home, "recipes")),
    exec: {
      runner: new AgentBrowserRunner({ bin: env.TYTO_AGENT_BROWSER ?? "agent-browser" }),
      lock: new FileSessionLock(join(home, "locks")),
      paths,
    },
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  };
}
