import type { Occupancy } from "../ports/occupancy.ts";
import type { Unsubscribe } from "../types.ts";

/** Production occupancy when no CDP input stream is attached. The seat stays idle. */
export class IdleOccupancy implements Occupancy {
  private active = false;
  private readonly listeners = new Set<() => void>();

  operatorActive(): boolean {
    return this.active;
  }

  interrupt(): void {
    this.active = false;
    for (const fn of this.listeners) fn();
  }

  yieldToOperator(): void {
    this.active = true;
    for (const fn of this.listeners) fn();
  }

  onOperatorInput(fn: () => void): Unsubscribe {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}
