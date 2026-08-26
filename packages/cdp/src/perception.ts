import { compactAx, type AxNode, type AxSnapshot, type FrameRef, type Perception, type TapeEvent } from "@tyto/core";
import { asRecord, cdpCall, type CdpWire } from "./wire.ts";

export type TapeSink = {
  push(kind: TapeEvent["kind"], detail: string): void;
};

export class CdpPerception implements Perception {
  private generation = 0;

  constructor(
    private readonly wire: CdpWire,
    private readonly tape: TapeSink,
    private readonly sessionFor: (frame: FrameRef) => string | undefined = () => undefined,
  ) {}

  async snapshot(target: FrameRef): Promise<AxSnapshot> {
    this.generation += 1;
    const generation = this.generation;
    const meta = { generation, origin: target.origin, url: `${target.origin}/`, title: "" };
    try {
      const raw = await cdpCall(this.wire, "Accessibility.getFullAXTree", {}, this.sessionFor(target));
      return compactAx(axNodes(raw), meta);
    } catch {
      this.tape.push("frame", `reasonEmpty: missing OOPIF ${target.frameId}`);
      return compactAx([], meta);
    }
  }
}

export function axNodes(raw: unknown): AxNode[] {
  const nodes = asRecord(raw)?.nodes;
  if (!Array.isArray(nodes)) return [];
  const out: AxNode[] = [];
  for (const item of nodes) {
    const rec = asRecord(item);
    if (typeof rec?.nodeId !== "string") continue;
    const node: AxNode = { nodeId: rec.nodeId };
    if (typeof rec.parentId === "string") node.parentId = rec.parentId;
    if (Array.isArray(rec.childIds) && rec.childIds.every((id) => typeof id === "string")) {
      node.childIds = rec.childIds;
    }
    if (rec.ignored === true) node.ignored = true;
    const role = asRecord(rec.role);
    if (typeof role?.value === "string") node.role = { value: role.value };
    const name = asRecord(rec.name);
    if (typeof name?.value === "string") node.name = { value: name.value };
    if (typeof rec.backendDOMNodeId === "number") node.backendDOMNodeId = rec.backendDOMNodeId;
    out.push(node);
  }
  return out;
}
