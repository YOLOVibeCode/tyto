import type { Clock } from "../ports/clock.ts";

/** Production clock. Occupancy idle and loop waits use this; tests inject FakeClock. */
export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
