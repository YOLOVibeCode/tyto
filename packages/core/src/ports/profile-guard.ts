import type { ProfileRef } from "../types.ts";

export interface ProfileGuard {
  defaultProfile(): ProfileRef;
  assertExplicitPick(picked: ProfileRef): void;
}
