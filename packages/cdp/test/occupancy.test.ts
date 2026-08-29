import { describe, expect, it } from "vitest";
import { CdpOccupancy, WEAVE_BINDING } from "../src/occupancy.ts";
import { CdpActuation } from "../src/actuation.ts";
import { ScriptedCdp } from "./scripted-cdp.ts";
import type { FrameRef } from "@tyto/core";

const FRAME: FrameRef = { tabId: "t", frameId: "main", origin: "https://ex.test" };

class ScriptedEvents {
  listener: ((method: string, params: unknown) => void) | undefined;
  onEvent(fn: (method: string, params: unknown) => void): () => void {
    this.listener = fn;
    return () => {
      this.listener = undefined;
    };
  }
  emit(method: string, params: unknown): void {
    this.listener?.(method, params);
  }
}

describe("CDP occupancy (weave)", () => {
  it("attach: Runtime.addBinding + Page.addScriptToEvaluateOnNewDocument, never Runtime.evaluate", async () => {
    const wire = new ScriptedCdp();
    wire.handlers.set("Runtime.addBinding", () => ({}));
    wire.handlers.set("Page.addScriptToEvaluateOnNewDocument", () => ({}));
    const events = new ScriptedEvents();
    const occ = new CdpOccupancy(wire, events, () => "sid-page");
    await occ.attach();
    expect(wire.calls.map((c) => c.method)).toEqual([
      "Runtime.enable",
      "Runtime.addBinding",
      "Page.addScriptToEvaluateOnNewDocument",
    ]);
    expect(wire.calls[1]?.params).toMatchObject({ name: WEAVE_BINDING });
    const source = String(
      (wire.calls[2]?.params as { source?: string } | undefined)?.source ?? "",
    );
    expect(source).toContain("isTrusted");
    expect(wire.calls.map((c) => c.method)).not.toContain("Runtime.evaluate");
  });

  it("trusted key event sets operatorActive; agent re-snapshot path does not perform", () => {
    const wire = new ScriptedCdp();
    const events = new ScriptedEvents();
    const occ = new CdpOccupancy(wire, events, () => undefined);
    expect(occ.operatorActive()).toBe(false);
    events.emit("Runtime.bindingCalled", {
      name: WEAVE_BINDING,
      payload: JSON.stringify({ kind: "key", key: "a" }),
    });
    expect(occ.operatorActive()).toBe(true);
  });

  it("input during agent actuation is ignored (does not yield to self)", async () => {
    const wire = new ScriptedCdp();
    const events = new ScriptedEvents();
    wire.handlers.set("Input.insertText", () => {
      events.emit("Runtime.bindingCalled", {
        name: WEAVE_BINDING,
        payload: JSON.stringify({ kind: "key", key: "x" }),
      });
      return {};
    });
    const occ = new CdpOccupancy(wire, events, () => undefined);
    const act = new CdpActuation(wire, () => undefined, occ);
    await act.perform({ op: "fill", node: 7, text: "agent", frame: FRAME });
    expect(occ.operatorActive()).toBe(false);
  });

  it("Esc → interrupt (not merely yield)", () => {
    const wire = new ScriptedCdp();
    const events = new ScriptedEvents();
    const occ = new CdpOccupancy(wire, events, () => undefined);
    let halted = 0;
    occ.onHalt = () => {
      halted += 1;
    };
    events.emit("Runtime.bindingCalled", {
      name: WEAVE_BINDING,
      payload: JSON.stringify({ kind: "key", key: "Escape" }),
    });
    expect(occ.operatorActive()).toBe(false);
    expect(halted).toBe(1);
  });
});
