import type { Unsubscribe } from "../types.ts";

export interface Occupancy {
  operatorActive(): boolean;
  interrupt(): void;
  yieldToOperator(): void;
  onOperatorInput(fn: () => void): Unsubscribe;
}
