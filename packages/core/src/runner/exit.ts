import { ShellNotReady } from "../ax/extract.ts";
import type { ConfirmGate } from "../ports/confirm-gate.ts";
import type { Operator } from "../ports/operator.ts";
import type { Intent } from "../types.ts";

export const RUNNER_EXIT = {
  done: 0,
  shellNotReady: 2,
  allowlistDeny: 3,
  confirmRequired: 4,
} as const;

export type UnattendedOpts = {
  allowConfirmFail: boolean;
};

export type UnattendedEvent =
  | { kind: "done" }
  | { kind: "deny" }
  | { kind: "confirm"; intent: Intent }
  | { kind: "error"; error: unknown };

/** Exit codes for the unattended runner. Never prompts. Operator is unused on purpose. */
export function unattendedExit(
  event: UnattendedEvent,
  opts: UnattendedOpts,
  gate: ConfirmGate,
  _operator: Operator,
): number {
  switch (event.kind) {
    case "done":
      return RUNNER_EXIT.done;
    case "deny":
      return RUNNER_EXIT.allowlistDeny;
    case "error":
      if (event.error instanceof ShellNotReady) return RUNNER_EXIT.shellNotReady;
      throw event.error instanceof Error ? event.error : new Error("unattended error");
    case "confirm": {
      if (!gate.mustConfirm(event.intent)) return RUNNER_EXIT.done;
      if (opts.allowConfirmFail) return RUNNER_EXIT.done;
      return RUNNER_EXIT.confirmRequired;
    }
  }
}
