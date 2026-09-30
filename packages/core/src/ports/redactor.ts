import type { CompleteRequest } from "../types.ts";

/** Strips secret-shaped values before text is stored or sent to a model. */
export interface Redactor {
  safe(text: string): string;
  prompt(req: CompleteRequest): CompleteRequest;
}
