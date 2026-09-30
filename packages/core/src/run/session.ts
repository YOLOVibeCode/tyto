import type { Recipe } from "../recipe/types.ts";

/** Files Tyto owns for replays: an agent-browser config (no saved logins) and an action policy. */
export type ReplayPaths = { config: string; policy: string };

export type ReplaySession = {
  session: string;
  args: string[];
  env: Record<string, string>;
};

export const DEFAULT_ACTION_TIMEOUT_MS = 6000;

/**
 * Public recipes run in `tyto-rx`: Tyto's own config (replaces the user's, so no saved logins) and a domain
 * allowlist. Approved `auth` recipes run in `tyto-rx-auth` with the user's saved logins (`--restore main`);
 * agent-browser refuses `--allowed-domains` together with `--restore`.
 */
export function replaySession(recipe: Recipe, paths: ReplayPaths, timeoutMs = DEFAULT_ACTION_TIMEOUT_MS): ReplaySession {
  const env = { AGENT_BROWSER_DEFAULT_TIMEOUT: String(timeoutMs), AGENT_BROWSER_CONFIG: paths.config };
  if (recipe.auth) {
    return { session: "tyto-rx-auth", args: ["--restore", "main", "--action-policy", paths.policy], env };
  }
  const hosts = [...new Set([...recipe.origins.map((o) => new URL(o).hostname), ...recipe.domains])];
  return { session: "tyto-rx", args: ["--allowed-domains", hosts.join(","), "--action-policy", paths.policy], env };
}
