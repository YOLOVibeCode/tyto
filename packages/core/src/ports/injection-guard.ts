import type { UntrustedDocument } from "../types.ts";

export interface InjectionGuard {
  wrapPageText(text: string): UntrustedDocument;
}
