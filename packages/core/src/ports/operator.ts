import type { ConfirmReason, Intent } from "../types.ts";

export interface Operator {
  confirm(reason: ConfirmReason, intent: Intent): Promise<boolean>;
  pasteGoal(text: string): void;
}
