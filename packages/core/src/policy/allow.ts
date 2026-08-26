import type { Origin } from "../types.ts";
import type { Allowlist } from "../ports/allowlist.ts";

export class OriginAllowlist implements Allowlist {
  private readonly granted = new Set<Origin>();

  grant(origin: Origin): void {
    this.granted.add(origin.replace(/\/$/, ""));
  }

  permits(url: URL): boolean {
    return this.granted.has(url.origin);
  }
}

export function originOf(url: string | URL): Origin {
  return (typeof url === "string" ? new URL(url) : url).origin;
}
