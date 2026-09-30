/** One message from agent-browser's per-session event stream (`~/.agent-browser/<session>.stream`). */
export type StreamEvent = { type: string; [key: string]: unknown };

export type TraceStep = {
  /** The agent-browser command, or null when the streamed action has no CLI equivalent. */
  argv: string[] | null;
  /** agent-browser's internal action name, e.g. "navigate", "getbylabel". */
  action: string;
  /** Redacted, truncated summary of the result (snapshot text, eval result, …). */
  output: string;
  error: string | null;
};

export type Trace = {
  name: string;
  task: string;
  session: string;
  startedAt: number;
  stoppedAt: number;
  /** Some events were dropped or unmatched; the compiler must confirm details on the live page. */
  lossy: boolean;
  gaps: string[];
  origins: string[];
  /** Typed inputs the user kept as params, with their example values. */
  params: Record<string, string>;
  steps: TraceStep[];
};

/** A typed input seen while recording. Values stay with the recorder; only the name and locator leave. */
export type TraceInput = { name: string; locator: string; sensitive: boolean; step: number };
