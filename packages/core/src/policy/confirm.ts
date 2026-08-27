import type { ConfirmReason, Intent } from "../types.ts";
import type { ConfirmGate } from "../ports/confirm-gate.ts";

const NEED_CONFIRM = new Set([
  "submit",
  "purchase",
  "delete",
  "send",
  "identity-capture",
  "identity-restore",
]);

export class DefaultConfirmGate implements ConfirmGate {
  mustConfirm(intent: Intent): ConfirmReason | null {
    if (NEED_CONFIRM.has(intent.kind)) return intent.kind as ConfirmReason;
    return null;
  }
}
