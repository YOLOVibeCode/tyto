import type {
  Actuation,
  BrowserHandle,
  FrameGraph,
  FrameRef,
  Navigation,
  Observation,
  Perception,
  Readiness,
  TapeEvent,
} from "@tyto/core";
import { CdpActuation, CdpFrameGraph, CdpNavigation, CdpPerception, CdpReadiness } from "@tyto/cdp";

type LaunchPorts = {
  observation?: Observation;
  perception?: Perception;
  actuation?: Actuation;
  navigation?: Navigation;
  frames?: FrameGraph;
  readiness?: Readiness;
};

function tapeFrom(observation: Observation | undefined): { push: (kind: TapeEvent["kind"], detail: string) => void } {
  const push = (observation as { push?: (kind: TapeEvent["kind"], detail: string) => void } | undefined)?.push;
  if (typeof push === "function") return { push: push.bind(observation) };
  return { push: () => undefined };
}

function cdpFrom(handle: BrowserHandle): { send: (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<unknown> } | undefined {
  const cdp = (handle as { cdp?: { send?: unknown } }).cdp;
  if (cdp && typeof cdp.send === "function") {
    return cdp as { send: (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<unknown> };
  }
  return undefined;
}

function pageSid(handle: BrowserHandle): string | undefined {
  const sid = (handle as { pageSessionId?: unknown }).pageSessionId;
  return typeof sid === "string" && sid ? sid : undefined;
}

/** After LAUNCH, bind perception/actuation/navigation to the page CDP session. No-op for non-CDP handles. */
export function attachCdpAdapters(handle: BrowserHandle, ports: LaunchPorts): void {
  const cdp = cdpFrom(handle);
  if (!cdp) return;
  const sid = pageSid(handle);
  const frames = new CdpFrameGraph(cdp);
  if (sid) frames.attachSession("main", sid);
  const sessionFor = (frame: FrameRef): string | undefined => frames.sessionId(frame) ?? sid;
  ports.frames = frames;
  ports.perception = new CdpPerception(cdp, tapeFrom(ports.observation), sessionFor);
  ports.actuation = new CdpActuation(cdp, sessionFor);
  ports.navigation = new CdpNavigation(cdp, () => sid);
  ports.readiness = new CdpReadiness(
    cdp,
    () => ({ tabId: "t", frameId: "main", origin: "about:blank" }),
    sessionFor,
  );
}
