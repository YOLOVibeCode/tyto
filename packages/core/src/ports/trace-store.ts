import type { Trace } from "../trace/types.ts";

export interface TraceStore {
  save(trace: Trace): Promise<void>;
  get(name: string): Promise<Trace | null>;
}
