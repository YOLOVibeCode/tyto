import type { AxSnapshot, ExtractResult } from "../types.ts";

export interface Extractor {
  fromAx(snap: AxSnapshot, query: string): ExtractResult;
}
