import type { Clock } from "../ports/clock.ts";
import type { Observation } from "../ports/observation.ts";
import type { Ms, TapeEvent } from "../types.ts";

export type TapeWaitResult = "ok" | "timeout";

/** Completes on a matching tape event. Clock.sleep is only the timeout budget, never success. */
export async function waitForTape(
  observation: Observation,
  pred: (e: TapeEvent) => boolean,
  budgetMs: Ms,
  clock: Clock,
): Promise<TapeWaitResult> {
  if (observation.recent(200).some(pred)) return "ok";
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (result: TapeWaitResult): void => {
      if (settled) return;
      settled = true;
      unsub();
      resolve(result);
    };
    const unsub = observation.subscribe((e) => {
      if (pred(e)) finish("ok");
    });
    void clock.sleep(budgetMs).then(() => finish("timeout"));
  });
}
