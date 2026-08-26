import type { ProfileRef } from "../types.ts";
import type { ProfileGuard } from "../ports/profile-guard.ts";

export class ExplicitProfileGuard implements ProfileGuard {
  constructor(private readonly catalogSize: number) {}

  defaultProfile(): ProfileRef {
    return { browser: "chrome", directory: "Tyto", name: "Tyto" };
  }

  assertExplicitPick(picked: ProfileRef): void {
    if (this.catalogSize > 0 && (!picked.directory || picked.name === "")) {
      throw new Error("profile pick required");
    }
  }
}
