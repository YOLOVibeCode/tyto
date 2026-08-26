import type { CompleteRequest, TapeEvent } from "../types.ts";

export interface Redactor {
  tape(event: TapeEvent): TapeEvent;
  prompt(req: CompleteRequest): CompleteRequest;
  safe(text: string): string;
}
