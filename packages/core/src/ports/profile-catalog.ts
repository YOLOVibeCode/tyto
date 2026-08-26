import type { ProfileRef } from "../types.ts";

export interface ProfileCatalog {
  list(browser: "chrome" | "edge"): Promise<ProfileRef[]>;
}
