import { classifyStats, compactAx, type DocStats, type FrameRef, type Ms, type Readiness } from "@tyto/core";
import { axNodes } from "./perception.ts";
import { cdpCall, type CdpWire } from "./wire.ts";

export class CdpReadiness implements Readiness {
  constructor(
    private readonly wire: CdpWire,
    private readonly frame: () => FrameRef,
    private readonly sessionFor: (frame: FrameRef) => string | undefined = () => undefined,
  ) {}

  async classify(): Promise<DocStats> {
    const target = this.frame();
    const raw = await cdpCall(this.wire, "Accessibility.getFullAXTree", {}, this.sessionFor(target));
    const nodes = axNodes(raw);
    const snap = compactAx(nodes, {
      generation: 0,
      origin: target.origin,
      url: `${target.origin}/`,
      title: "",
    });
    return classifyStats({
      textLen: snap.tree.length,
      elements: snap.refs.size,
      tables: 0,
      mainLen: snap.tree.length,
      axNodes: nodes.length,
      textStart: snap.tree.slice(0, 400),
    });
  }

  async waitReady(_budget: Ms): Promise<DocStats> {
    return this.classify();
  }
}
