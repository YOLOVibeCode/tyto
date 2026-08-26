import type { ConfirmReason, Intent } from "../types.ts";

export interface ConfirmGate {
  mustConfirm(intent: Intent): ConfirmReason | null;
}
