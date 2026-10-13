import type { StreamEvent } from "../trace/types.ts";

/** agent-browser's per-session event stream. Ends with `{ type: "closed" }` if the socket closes. */
export interface BrowserEventSource {
  subscribe(session: string, signal: AbortSignal): AsyncIterable<StreamEvent>;
}
