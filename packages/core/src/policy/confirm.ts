import type { ConfirmReason, Intent } from "../types.ts";
import type { ConfirmGate } from "../ports/confirm-gate.ts";

const DESTRUCTIVE = new Set(["submit", "purchase", "delete", "send"]);

export class DefaultConfirmGate implements ConfirmGate {
  mustConfirm(intent: Intent): ConfirmReason | null {
    if (DESTRUCTIVE.has(intent.kind)) return intent.kind as ConfirmReason;
    return null;
  }
}
