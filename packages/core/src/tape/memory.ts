import type { Observation } from "../ports/observation.ts";
import type { TapeEvent, Unsubscribe } from "../types.ts";

/** In-process tape. Production host uses this until CDP events are attached. */
export class MemoryTape implements Observation {
  events: TapeEvent[] = [];
  private readonly listeners = new Set<(e: TapeEvent) => void>();

  subscribe(fn: (e: TapeEvent) => void): Unsubscribe {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  recent(n: number): TapeEvent[] {
    return this.events.slice(-n);
  }

  push(kind: TapeEvent["kind"], detail: string): void {
    const e: TapeEvent = { t: this.events.length, kind, detail };
    this.events.push(e);
    for (const fn of this.listeners) fn(e);
  }
}
