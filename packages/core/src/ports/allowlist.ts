import type { Origin } from "../types.ts";

export interface Allowlist {
  permits(url: URL): boolean;
  grant(origin: Origin): void;
}
