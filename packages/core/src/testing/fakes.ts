import type { Clock } from "../ports/clock.ts";
import type { ModelPort } from "../ports/model.ts";
import type { CompleteRequest, CompleteResponse } from "../types.ts";

export class FakeClock implements Clock {
  t = 0;
  sleeps = 0;
  private waiters: Array<{ due: number; resolve: () => void }> = [];

  now(): number {
    return this.t;
  }

  async sleep(ms: number): Promise<void> {
    this.sleeps += 1;
    const due = this.t + ms;
    if (due <= this.t) return;
    return new Promise((resolve) => {
      this.waiters.push({ due, resolve });
    });
  }

  /** Resolve pending `sleep` waiters whose due time has been reached. */
  advance(ms: number): void {
    this.t += ms;
    const ready = this.waiters.filter((w) => w.due <= this.t);
    this.waiters = this.waiters.filter((w) => w.due > this.t);
    for (const w of ready) w.resolve();
  }
}

export class FakeModel implements ModelPort {
  calls = 0;
  last?: CompleteRequest;
  canned: CompleteResponse = { text: "ok" };
  async complete(req: CompleteRequest): Promise<CompleteResponse> {
    this.calls += 1;
    this.last = req;
    return this.canned;
  }
}
