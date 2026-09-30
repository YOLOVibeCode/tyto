import { homedir } from "node:os";
import { join } from "node:path";
import type { ReplayPaths } from "@tyto/core";
import { readIfExists, writePrivate } from "./files.ts";

export const DEFAULT_USER_CONFIG = join(homedir(), ".agent-browser", "config.json");

/**
 * Write the files `tyto-rx` replays use: an agent-browser config that replaces the user's (so saved logins
 * never load) but keeps their browser choice, and an action policy denying downloads and uploads.
 */
export async function ensureReplayFiles(tytoHome: string, userConfigPath: string = DEFAULT_USER_CONFIG): Promise<ReplayPaths> {
  let executablePath: string | undefined;
  const text = await readIfExists(userConfigPath);
  if (text !== null) {
    try {
      const user = JSON.parse(text) as { executablePath?: unknown };
      if (typeof user.executablePath === "string") executablePath = user.executablePath;
    } catch {
      executablePath = undefined;
    }
  }
  const paths = { config: join(tytoHome, "agent-browser.json"), policy: join(tytoHome, "policy.json") };
  await writePrivate(paths.config, `${JSON.stringify(executablePath ? { executablePath } : {}, null, 2)}\n`);
  await writePrivate(paths.policy, `${JSON.stringify({ default: "allow", deny: ["download", "upload"] }, null, 2)}\n`);
  return paths;
}
