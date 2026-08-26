import type { BindPolicy } from "../ports/bind-policy.ts";

export class LoopbackBindPolicy implements BindPolicy {
  assertLoopback(host: string): void {
    const h = host.replace(/^\[|\]$/g, "").toLowerCase();
    if (h === "127.0.0.1" || h === "localhost" || h === "::1") return;
    throw new Error(`bind refused: ${host} is not loopback`);
  }
}
