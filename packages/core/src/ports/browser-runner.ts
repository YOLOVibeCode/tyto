/** One agent-browser batch step result, with agent-browser's lifecycle noise removed. */
export type BatchStepResult = {
  command: readonly string[];
  success: boolean;
  result: unknown;
  error: string | null;
};

export type RunOptions = {
  session: string;
  /** Global flags placed after `--session` and before the command, e.g. `--allowed-domains x`. */
  args?: readonly string[];
  env?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
};

export type RunOutput = { exitCode: number; stdout: string; stderr: string };

/** The agent-browser CLI. Adapter: packages/agent-browser. */
export interface BrowserRunner {
  run(argv: readonly string[], opts: RunOptions): Promise<RunOutput>;
  batch(steps: readonly (readonly string[])[], opts: RunOptions): Promise<BatchStepResult[]>;
}
