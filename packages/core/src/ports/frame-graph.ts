import type { FrameNode, FrameRef, TabId } from "../types.ts";

export interface FrameGraph {
  list(tab: TabId): Promise<FrameNode[]>;
  focus(frame: FrameRef): void;
  autoAttachChildTargets(on: boolean): Promise<void>;
}
