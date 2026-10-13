export type TytoSession = { session: string; pid: number; version: string | null };

export type DoctorDeps = {
  nodeVersion: string;
  agentBrowserVersion: () => Promise<string | null>;
  claudeVersion: () => Promise<string | null>;
  /** Path of `tyto` on PATH, or null. */
  launcher: () => Promise<string | null>;
  /** Tyto's own agent-browser sessions that are running (tyto-rx, tyto-rx-auth, tyto-compile). */
  sessions: () => Promise<TytoSession[]>;
  closeSession: (session: string) => Promise<void>;
};

type Io = { out: (line: string) => void; err: (line: string) => void };

const MIN_AGENT_BROWSER = [0, 38, 1] as const;

function parse(version: string): number[] {
  return (/(\d+)\.(\d+)\.(\d+)/.exec(version) ?? []).slice(1).map(Number);
}

function atLeast(v: readonly number[], min: readonly number[]): boolean {
  for (let i = 0; i < min.length; i += 1) {
    if ((v[i] ?? 0) !== (min[i] ?? 0)) return (v[i] ?? 0) > (min[i] ?? 0);
  }
  return true;
}

/** Matches package.json engines: ^22.22.2 || ^24.15.0 || >=26. */
export function nodeSupported(version: string): boolean {
  const [major = 0, minor = 0, patch = 0] = parse(version);
  if (major === 22) return atLeast([major, minor, patch], [22, 22, 2]);
  if (major === 24) return atLeast([major, minor, patch], [24, 15, 0]);
  return major >= 26;
}

export async function doctor(args: readonly string[], deps: DoctorDeps, io: Io): Promise<number> {
  let problems = 0;
  const bad = (line: string): void => {
    problems += 1;
    io.out(`✗ ${line}`);
  };
  if (nodeSupported(deps.nodeVersion)) io.out(`✓ Node ${deps.nodeVersion}`);
  else bad(`Node ${deps.nodeVersion} is too old; Tyto needs 22.22+, 24.15+, or 26 (nvm install 26)`);

  const ab = await deps.agentBrowserVersion();
  if (ab === null) bad("agent-browser not found: brew install agent-browser && agent-browser install");
  else if (!atLeast(parse(ab), MIN_AGENT_BROWSER)) bad(`agent-browser ${ab} is older than ${MIN_AGENT_BROWSER.join(".")}: brew upgrade agent-browser`);
  else io.out(`✓ agent-browser ${ab}`);

  const claude = await deps.claudeVersion();
  io.out(claude ? `✓ Claude Code ${claude} (compiler)` : "! claude (Claude Code) not found: needed only for tyto compile and tyto repair");

  const launcher = await deps.launcher();
  if (launcher) io.out(`✓ tyto on PATH: ${launcher}`);
  else bad("tyto is not on your PATH: run tyto install (from the Tyto repo: node packages/cli/bin/tyto.mjs install)");

  const sessions = await deps.sessions();
  for (const s of sessions) io.out(`  running: ${s.session} (pid ${s.pid}${s.version ? `, agent-browser ${s.version}` : ""})`);
  if (args.includes("--fix")) {
    for (const s of sessions) {
      await deps.closeSession(s.session);
      io.out(`  closed ${s.session}; it restarts with Tyto's settings on next use`);
    }
  } else if (sessions.length) {
    io.out("  (if a replay ever waits ~25 s, run `tyto doctor --fix` to restart these with Tyto's 6 s timeout)");
  }
  return problems ? 1 : 0;
}
