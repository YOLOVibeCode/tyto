import type {
  Actuation,
  BrowserHandle,
  FrameGraph,
  FrameRef,
  Navigation,
  Observation,
  Occupancy,
  Perception,
  Readiness,
  TapeEvent,
} from "@tyto/core";
import { AgentLoop } from "@tyto/core";
import { CdpActuation, CdpFrameGraph, CdpNavigation, CdpOccupancy, CdpPerception, CdpReadiness } from "@tyto/cdp";

type LaunchPorts = {
  observation?: Observation;
  perception?: Perception;
  actuation?: Actuation;
  navigation?: Navigation;
  frames?: FrameGraph;
  readiness?: Readiness;
  occupancy?: Occupancy;
};

export type LaunchRuntime = {
  loop: AgentLoop | undefined;
};

function tapeFrom(observation: Observation | undefined): { push: (kind: TapeEvent["kind"], detail: string) => void } {
  const push = (observation as { push?: (kind: TapeEvent["kind"], detail: string) => void } | undefined)?.push;
  if (typeof push === "function") return { push: push.bind(observation) };
  return { push: () => undefined };
}

export function cdpFrom(handle: BrowserHandle): {
  send: (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<unknown>;
  onEvent?: (fn: (method: string, params: unknown) => void) => () => void;
} | undefined {
  const cdp = (handle as { cdp?: { send?: unknown; onEvent?: unknown } }).cdp;
  if (cdp && typeof cdp.send === "function") {
    return cdp as {
      send: (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<unknown>;
      onEvent?: (fn: (method: string, params: unknown) => void) => () => void;
    };
  }
  return undefined;
}

function pageSid(handle: BrowserHandle): string | undefined {
  const sid = (handle as { pageSessionId?: unknown }).pageSessionId;
  return typeof sid === "string" && sid ? sid : undefined;
}

/** After LAUNCH, bind perception/actuation/navigation/occupancy to the page CDP session. */
export async function attachCdpAdapters(
  handle: BrowserHandle,
  ports: LaunchPorts,
  runtime?: LaunchRuntime,
): Promise<void> {
  const cdp = cdpFrom(handle);
  if (!cdp) return;
  const sid = pageSid(handle);
  const frames = new CdpFrameGraph(cdp);
  if (sid) frames.attachSession("main", sid);
  const sessionFor = (frame: FrameRef): string | undefined => frames.sessionId(frame) ?? sid;
  ports.frames = frames;
  ports.perception = new CdpPerception(cdp, tapeFrom(ports.observation), sessionFor);
  ports.navigation = new CdpNavigation(cdp, () => sid);
  ports.readiness = new CdpReadiness(
    cdp,
    () => ({ tabId: "t", frameId: "main", origin: "about:blank" }),
    sessionFor,
  );

  let gate: CdpOccupancy | undefined;
  if (typeof cdp.onEvent === "function") {
    const occ = new CdpOccupancy(cdp, { onEvent: (fn) => cdp.onEvent!(fn) }, () => pageSid(handle));
    occ.onHalt = () => runtime?.loop?.stop();
    await occ.attach();
    ports.occupancy = occ;
    gate = occ;
  }
  ports.actuation =
    gate !== undefined ? new CdpActuation(cdp, sessionFor, gate) : new CdpActuation(cdp, sessionFor);
}
