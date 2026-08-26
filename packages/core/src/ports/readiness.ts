import type { DocStats, Ms } from "../types.ts";

export interface Readiness {
  classify(): Promise<DocStats>;
  waitReady(budget: Ms): Promise<DocStats>;
}
