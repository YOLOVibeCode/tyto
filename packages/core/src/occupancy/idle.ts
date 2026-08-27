import type { Occupancy } from "../ports/occupancy.ts";
import type { Unsubscribe } from "../types.ts";

/** Production occupancy when no CDP input stream is attached. The seat stays idle. */
export class IdleOccupancy implements Occupancy {
  operatorActive(): boolean {
    return false;
  }

  interrupt(): void {}

  yieldToOperator(): void {}

  onOperatorInput(_fn: () => void): Unsubscribe {
    return () => undefined;
  }
}
