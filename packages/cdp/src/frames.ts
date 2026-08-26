import type { FrameGraph, FrameNode, FrameRef, TabId } from "@tyto/core";
import { type CdpWire } from "./wire.ts";

export class CdpFrameGraph implements FrameGraph {
  private readonly sessions = new Map<string, string>();
  private focused: FrameRef | undefined;

  constructor(private readonly wire: CdpWire) {}

  attachSession(frameId: string, sessionId: string): void {
    this.sessions.set(frameId, sessionId);
  }

  sessionId(frame: FrameRef): string | undefined {
    return this.sessions.get(frame.frameId);
  }

  async list(tab: TabId): Promise<FrameNode[]> {
    const out: FrameNode[] = [];
    for (const frameId of this.sessions.keys()) {
      out.push({
        ref: { tabId: tab, frameId, origin: "" },
        origin: "",
        attached: true,
      });
    }
    return out;
  }

  focus(frame: FrameRef): void {
    this.focused = frame;
  }

  async autoAttachChildTargets(on: boolean): Promise<void> {
    await this.wire.send("Target.setAutoAttach", {
      autoAttach: on,
      waitForDebuggerOnStart: false,
      flatten: true,
    });
  }
}
