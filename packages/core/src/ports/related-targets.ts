import type { TabId } from "../types.ts";

export type Tab = { id: TabId; url: string };

export interface RelatedTargets {
  pages(): Promise<Tab[]>;
}
