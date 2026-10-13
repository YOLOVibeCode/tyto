import type { BrowserEventSource } from "../ports/browser-events.ts";
import type { BrowserRunner } from "../ports/browser-runner.ts";
import type { StreamEvent } from "./types.ts";

export type RecorderDeps = { events: BrowserEventSource; runner: BrowserRunner };

const MARKER_TIMEOUT_MS = 10_000;

/**
 * Listens to a session's event stream. After subscribing it runs `get url` as a sync marker and records only
 * what happens after the marker's result — proof the stream is live and nothing earlier leaks in.
 */
export class Recorder {
  readonly #deps: RecorderDeps;
  readonly #buffer: StreamEvent[] = [];
  #recording = false;

  constructor(deps: RecorderDeps) {
    this.#deps = deps;
  }

  events(): StreamEvent[] {
    return [...this.#buffer];
  }

  start(session: string, signal: AbortSignal, markerTimeoutMs = MARKER_TIMEOUT_MS): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let markerId: string | null = null;
      let triggered = false;
      const timer = setTimeout(() => {
        if (!this.#recording) reject(new Error("agent-browser's event stream did not answer the sync marker"));
      }, markerTimeoutMs);
      const begin = (): void => {
        this.#recording = true;
        clearTimeout(timer);
        resolve();
      };
      const iterate = async (): Promise<void> => {
        try {
          for await (const ev of this.#deps.events.subscribe(session, signal)) {
            if (this.#recording) {
              this.#buffer.push(ev);
              continue;
            }
            if (triggered && markerId === null && ev.type === "command" && ev.action === "url") markerId = String(ev.id);
            else if (markerId !== null && ev.type === "result" && String(ev.id) === markerId) begin();
          }
        } catch (err) {
          clearTimeout(timer);
          if (!this.#recording) reject(err instanceof Error ? err : new Error(String(err)));
        }
      };
      void iterate();
      triggered = true;
      this.#deps.runner.run(["get", "url"], { session }).catch((err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }
}
