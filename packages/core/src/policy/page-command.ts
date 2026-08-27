import type { Allowlist } from "../ports/allowlist.ts";
import type { FrameGraph } from "../ports/frame-graph.ts";

/**
 * Page JS is data, never a command channel. postMessage cannot focus a frame
 * or grant an origin.
 */
export function applyPageMessage(
  _msg: unknown,
  _ports: { allowlist: Allowlist; frames: FrameGraph },
): false {
  return false;
}
