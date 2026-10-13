import { BATCH_LANES, type BrowserRunner } from "@tyto/core";

/** Tyto's own agent-browser sessions: replays, logged-in replays, the compiler, and the batch lanes. */
export const TYTO_SESSIONS: readonly string[] = [
  "tyto-rx",
  "tyto-rx-auth",
  "tyto-compile",
  ...Array.from({ length: BATCH_LANES }, (_, i) => `tyto-rx-${i + 1}`),
];

/**
 * Close one of Tyto's sessions under Tyto's agent-browser config, as every Tyto command runs them. Under the
 * user's own config, `close` may save that session's cookies into the user's restore state.
 */
export function closeTytoSession(runner: BrowserRunner, config: string): (session: string) => Promise<void> {
  return async (session) => {
    await runner.run(["close"], { session, env: { AGENT_BROWSER_CONFIG: config } });
  };
}
