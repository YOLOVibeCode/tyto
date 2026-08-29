import type { Occupancy, Unsubscribe } from "@tyto/core";
import { cdpCall, type CdpWire } from "./wire.ts";

export const WEAVE_BINDING = "tytoWeave";

export type AgentInputGate = {
  enter(): void;
  exit(): void;
};

export type OccupancyEvents = {
  onEvent(fn: (method: string, params: unknown) => void): Unsubscribe;
};

/** Injected on every document. Observes trusted input only; never a command API. */
const WEAVE_SCRIPT = `(() => {
  if (globalThis.__tytoWeaveInstalled) return;
  globalThis.__tytoWeaveInstalled = true;
  const send = (kind, key) => {
    try { tytoWeave(JSON.stringify({ kind, key })); } catch (e) {}
  };
  addEventListener("keydown", (e) => {
    if (!e.isTrusted) return;
    send("key", e.key);
  }, true);
  addEventListener("pointerdown", (e) => {
    if (!e.isTrusted) return;
    send("pointer", "");
  }, true);
})();`;

type BindingPayload = { kind?: string; key?: string };

/**
 * Occupancy from real (isTrusted) key/pointer events.
 * Agent Input.* is masked via AgentInputGate so the loop does not yield to itself.
 */
export class CdpOccupancy implements Occupancy, AgentInputGate {
  private active = false;
  private suppress = 0;
  private interrupting = false;
  private readonly listeners = new Set<() => void>();
  onHalt: (() => void) | undefined;

  constructor(
    private readonly wire: CdpWire,
    events: OccupancyEvents,
    private readonly sessionId: () => string | undefined,
  ) {
    events.onEvent((method, params) => this.onCdpEvent(method, params));
  }

  async attach(): Promise<void> {
    const sid = this.sessionId();
    await cdpCall(this.wire, "Runtime.enable", {}, sid);
    await cdpCall(this.wire, "Runtime.addBinding", { name: WEAVE_BINDING }, sid);
    await cdpCall(this.wire, "Page.addScriptToEvaluateOnNewDocument", { source: WEAVE_SCRIPT }, sid);
  }

  enter(): void {
    this.suppress += 1;
  }

  exit(): void {
    this.suppress = Math.max(0, this.suppress - 1);
  }

  operatorActive(): boolean {
    return this.active;
  }

  interrupt(): void {
    if (this.interrupting) return;
    this.interrupting = true;
    this.active = false;
    for (const fn of this.listeners) fn();
    try {
      this.onHalt?.();
    } finally {
      this.interrupting = false;
    }
  }

  yieldToOperator(): void {
    this.active = true;
    for (const fn of this.listeners) fn();
  }

  onOperatorInput(fn: () => void): Unsubscribe {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private onCdpEvent(method: string, params: unknown): void {
    if (method !== "Runtime.bindingCalled") return;
    if (!params || typeof params !== "object" || Array.isArray(params)) return;
    const rec = params as { name?: unknown; payload?: unknown };
    if (rec.name !== WEAVE_BINDING || typeof rec.payload !== "string") return;
    if (this.suppress > 0) return;
    let body: BindingPayload = {};
    try {
      body = JSON.parse(rec.payload) as BindingPayload;
    } catch {
      return;
    }
    if (body.kind === "key" && body.key === "Escape") {
      this.interrupt();
      return;
    }
    this.yieldToOperator();
  }
}
