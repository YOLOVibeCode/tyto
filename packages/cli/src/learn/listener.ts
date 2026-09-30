import { buildTrace, type Recorder, type Redactor, type TraceStore } from "@tyto/core";
import type { ControlReply, ControlRequest } from "./control.ts";

export type ListenerDeps = {
  recorder: Recorder;
  traces: TraceStore;
  redactor: Redactor;
  now: () => number;
  serve: (handler: (req: ControlRequest) => Promise<ControlReply>) => Promise<() => Promise<void>>;
  tracePath: (name: string) => string;
  /** Give up (without saving) after this long. */
  maxMs?: number;
};

/** The background `tyto learn` process: record until `stop`, then save the trace. Typed values stay in memory. */
export async function runListener(name: string, session: string, deps: ListenerDeps): Promise<void> {
  const ac = new AbortController();
  const startedAt = deps.now();
  await deps.recorder.start(session, ac.signal);
  const opts = { name, session, redactor: deps.redactor, now: deps.now, startedAt };
  let finish: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let close: () => Promise<void> = async () => undefined;
  const shutdown = (): void => {
    setTimeout(() => {
      ac.abort();
      void close().finally(finish);
    }, 0);
  };
  close = await deps.serve(async (req) => {
    if (req.op === "status") {
      const { trace, inputs } = buildTrace(deps.recorder.events(), opts, {});
      return { ok: true, inputs, steps: trace.steps.length, lossy: trace.lossy, gaps: trace.gaps };
    }
    const { trace, inputs } = buildTrace(deps.recorder.events(), { ...opts, task: req.task }, req.keep);
    await deps.traces.save(trace);
    shutdown();
    return { ok: true, inputs, steps: trace.steps.length, lossy: trace.lossy, gaps: trace.gaps, params: trace.params, trace: deps.tracePath(name) };
  });
  const limit = deps.maxMs ? setTimeout(shutdown, deps.maxMs) : null;
  await finished;
  if (limit) clearTimeout(limit);
}
