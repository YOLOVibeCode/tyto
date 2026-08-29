import type { Actuation, FrameRef, TrustedIntent } from "@tyto/core";
import { asRecord, cdpCall, type CdpWire } from "./wire.ts";
import type { AgentInputGate } from "./occupancy.ts";

export class CdpActuation implements Actuation {
  constructor(
    private readonly wire: CdpWire,
    private readonly sessionFor: (frame: FrameRef) => string | undefined = () => undefined,
    private readonly gate: AgentInputGate | undefined = undefined,
  ) {}

  async perform(intent: TrustedIntent): Promise<void> {
    this.gate?.enter();
    try {
      const sid = this.sessionFor(intent.frame);
      if (intent.op === "press") {
        const key = intent.key ?? "";
        await cdpCall(this.wire, "Input.dispatchKeyEvent", { type: "keyDown", key }, sid);
        await cdpCall(this.wire, "Input.dispatchKeyEvent", { type: "keyUp", key }, sid);
        return;
      }
      if (intent.op === "scroll" && intent.node !== undefined) {
        await cdpCall(this.wire, "DOM.scrollIntoViewIfNeeded", { backendNodeId: intent.node }, sid);
        return;
      }
      await this.click(intent, sid);
      if ((intent.op === "fill" || intent.op === "insertText") && intent.text) {
        await cdpCall(this.wire, "Input.insertText", { text: intent.text }, sid);
      }
    } finally {
      this.gate?.exit();
    }
  }

  private async click(intent: TrustedIntent, sid: string | undefined): Promise<void> {
    if (intent.node === undefined) throw new Error("trusted click requires backendNodeId");
    await cdpCall(this.wire, "DOM.scrollIntoViewIfNeeded", { backendNodeId: intent.node }, sid);
    const raw = await cdpCall(this.wire, "DOM.getBoxModel", { backendNodeId: intent.node }, sid);
    const { x, y } = boxCenter(raw);
    const mouse = { x, y, button: "left", clickCount: 1 };
    await cdpCall(this.wire, "Input.dispatchMouseEvent", { type: "mousePressed", ...mouse }, sid);
    await cdpCall(this.wire, "Input.dispatchMouseEvent", { type: "mouseReleased", ...mouse }, sid);
  }
}

function boxCenter(raw: unknown): { x: number; y: number } {
  const content = asRecord(asRecord(raw)?.model)?.content;
  if (!Array.isArray(content)) throw new Error("no box model");
  const x1 = content[0];
  const y1 = content[1];
  const x3 = content[4];
  const y3 = content[5];
  if (typeof x1 !== "number" || typeof y1 !== "number" || typeof x3 !== "number" || typeof y3 !== "number") {
    throw new Error("no box model");
  }
  const x = (x1 + x3) / 2;
  const y = (y1 + y3) / 2;
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("no box model");
  return { x, y };
}
