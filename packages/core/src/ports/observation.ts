import type { TapeEvent, Unsubscribe } from "../types.ts";

export interface Observation {
  subscribe(fn: (e: TapeEvent) => void): Unsubscribe;
  recent(n: number): TapeEvent[];
}
