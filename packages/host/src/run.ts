/**
 * Unattended runner. Never prompts.
 * Usage: TYTO_LIVE=1 npx tsx packages/host/src/run.ts --session <id> [--allow-confirm-fail]
 */
import { homedir } from "node:os";
import { join } from "node:path";
import {
  parseRunnerArgs,
  runUnattended,
  type SessionStore,
  type UnattendedDeps,
} from "@tyto/core";
import { FilesystemSessionStore } from "@tyto/fs";

const silentOperator = {
  confirm: async () => {
    throw new Error("HITL must not run in unattended runner");
  },
  pasteGoal(): void {},
};

export async function runnerMain(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  injected?: { store?: SessionStore; deps?: UnattendedDeps },
): Promise<number> {
  const args = parseRunnerArgs(argv);
  if (!args.sessionId) {
    process.stderr.write("usage: --session <id> [--allow-confirm-fail]\n");
    return 1;
  }
  const sessionDir = env.TYTO_SESSION_DIR ?? join(homedir(), ".tyto", "sessions");
  const store = injected?.store ?? new FilesystemSessionStore(sessionDir);
  const session = await store.load(args.sessionId);
  if (!session) {
    process.stderr.write("session not found\n");
    return 1;
  }
  if (!injected?.deps) {
    process.stderr.write("unattended runner requires injected live ports (tests) or a host composition root\n");
    return 1;
  }
  const origin = session.lastUrl ? new URL(session.lastUrl).origin : "https://example.com";
  return runUnattended(
    session,
    { tabId: "t", frameId: "main", origin },
    { allowConfirmFail: args.allowConfirmFail },
    { ...injected.deps, store },
    silentOperator,
  );
}

const isCli = process.argv[1]?.replace(/\\/g, "/").endsWith("/run.ts");
if (isCli) {
  void runnerMain(process.argv.slice(2)).then((code) => process.exit(code));
}
