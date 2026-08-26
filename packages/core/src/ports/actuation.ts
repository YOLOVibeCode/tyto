import type { TrustedIntent } from "../types.ts";

export interface Actuation {
  perform(intent: TrustedIntent): Promise<void>;
}
