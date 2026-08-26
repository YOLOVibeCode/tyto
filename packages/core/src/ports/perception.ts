import type { AxSnapshot, FrameRef } from "../types.ts";

export interface Perception {
  snapshot(target: FrameRef): Promise<AxSnapshot>;
}
