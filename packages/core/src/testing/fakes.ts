import { compactAx } from "../ax/compact.ts";
import type { Actuation } from "../ports/actuation.ts";
import type { Clock } from "../ports/clock.ts";
import type { CredentialStorePort } from "../ports/credential-store.ts";
import type { FrameGraph } from "../ports/frame-graph.ts";
import type { ModelPort } from "../ports/model.ts";
import type { Navigation } from "../ports/navigation.ts";
import type { Occupancy } from "../ports/occupancy.ts";
import { MemoryTape } from "../tape/memory.ts";
import type { Perception } from "../ports/perception.ts";
import type { Readiness } from "../ports/readiness.ts";
import type { RelatedTargets, Tab } from "../ports/related-targets.ts";
import type { SessionStore } from "../ports/session-store.ts";
import type {
  AxNode,
  AxSnapshot,
  CompleteRequest,
  CompleteResponse,
  DocShape,
  DocStats,
  FrameNode,
  FrameRef,
  Ms,
  Origin,
  RawCookie,
  RawStorageItems,
  Session,
  SessionId,
  SessionSummary,
  TabId,
  TrustedIntent,
  Unsubscribe,
} from "../types.ts";
import { parseSession, serializeSession } from "../session/schema.ts";

export class MemorySessionStore implements SessionStore {
  private readonly files = new Map<SessionId, string>();

  async load(id: SessionId): Promise<Session | null> {
    const raw = this.files.get(id);
    return raw ? parseSession(raw) : null;
  }

  async save(session: Session): Promise<void> {
    this.files.set(session.id, serializeSession(session));
  }

  async list(): Promise<SessionSummary[]> {
    const out: SessionSummary[] = [];
    for (const raw of this.files.values()) {
      const s = parseSession(raw);
      out.push({ id: s.id, goal: s.goal, lastUrl: s.lastUrl });
    }
    return out;
  }

  /** Test helper: inspect serialized JSON. */
  raw(id: SessionId): string | undefined {
    return this.files.get(id);
  }
}

export class FakeClock implements Clock {
  t = 0;
  sleeps = 0;
  private waiters: Array<{ due: number; resolve: () => void }> = [];

  now(): number {
    return this.t;
  }

  async sleep(ms: number): Promise<void> {
    this.sleeps += 1;
    const due = this.t + ms;
    if (due <= this.t) return;
    return new Promise((resolve) => {
      this.waiters.push({ due, resolve });
    });
  }

  /** Resolve pending `sleep` waiters whose due time has been reached. Not a success path for WAIT. */
  advance(ms: number): void {
    this.t += ms;
    const ready = this.waiters.filter((w) => w.due <= this.t);
    this.waiters = this.waiters.filter((w) => w.due > this.t);
    for (const w of ready) w.resolve();
  }
}

export class FakeOccupancy implements Occupancy {
  active = false;
  interrupted = false;
  private readonly listeners = new Set<() => void>();

  /** Simulate a real key or mouse from the operator. */
  noteInput(): void {
    this.yieldToOperator();
  }

  yieldToOperator(): void {
    this.active = true;
    for (const fn of this.listeners) fn();
  }

  interrupt(): void {
    this.interrupted = true;
    this.active = false;
    for (const fn of this.listeners) fn();
  }

  operatorActive(): boolean {
    return this.active;
  }

  onOperatorInput(fn: () => void): Unsubscribe {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export class FakeActuation implements Actuation {
  readonly performed: TrustedIntent[] = [];
  async perform(intent: TrustedIntent): Promise<void> {
    this.performed.push(intent);
  }
}

export class FakeModel implements ModelPort {
  calls = 0;
  last?: CompleteRequest;
  canned: CompleteResponse = { text: '{"rationale":"ok","anchors":[],"steps":[{"op":"done","reason":"ok"}]}' };
  async complete(req: CompleteRequest): Promise<CompleteResponse> {
    this.calls += 1;
    this.last = req;
    return this.canned;
  }
}

export class FakeObservation extends MemoryTape {}

export class FakePerception implements Perception {
  generation = 0;
  currentUrl = "about:blank";
  private readonly byUrl = new Map<string, { nodes: AxNode[]; title: string }>();
  private readonly byFrame = new Map<string, { nodes: AxNode[]; title: string; origin: string }>();

  seedUrl(url: string, nodes: AxNode[], title: string): void {
    this.byUrl.set(url, { nodes, title });
  }

  seedFrame(frameId: string, nodes: AxNode[], title: string, origin: string): void {
    this.byFrame.set(frameId, { nodes, title, origin });
  }

  async snapshot(target: FrameRef): Promise<AxSnapshot> {
    this.generation += 1;
    const framed = this.byFrame.get(target.frameId);
    const page = framed ?? this.byUrl.get(this.currentUrl);
    const origin = framed?.origin ?? target.origin;
    const snap = compactAx(page?.nodes ?? [], {
      generation: this.generation,
      origin,
      url: this.currentUrl,
      title: page?.title ?? "",
    });
    return { ...snap, tree: `# frame ${origin}\n${snap.tree}` };
  }
}

export class FakeNavigation implements Navigation {
  gotoCalls = 0;

  constructor(
    private readonly perception: FakePerception,
    private readonly observation: FakeObservation,
  ) {}

  async goto(url: URL): Promise<void> {
    this.gotoCalls += 1;
    this.perception.currentUrl = url.href;
    this.observation.push("nav", url.href);
  }

  async currentUrl(): Promise<URL> {
    return new URL(this.perception.currentUrl);
  }
}

function statsFor(shape: DocShape): DocStats {
  if (shape === "injected") {
    return {
      textLen: 8000,
      elements: 400,
      tables: 4,
      mainLen: 5000,
      axNodes: 80,
      shape: "injected",
      shellMarker: false,
    };
  }
  if (shape === "static") {
    return {
      textLen: 80_000,
      elements: 900,
      tables: 12,
      mainLen: 40_000,
      axNodes: 400,
      shape: "static",
      shellMarker: false,
    };
  }
  return {
    textLen: 200,
    elements: 12,
    tables: 0,
    mainLen: 40,
    axNodes: 8,
    shape: "shell",
    shellMarker: true,
  };
}

function frameKey(frame: FrameRef): string {
  return `${frame.tabId}:${frame.frameId}`;
}

export class FakeReadiness implements Readiness {
  target: FrameRef = { tabId: "t", frameId: "main", origin: "https://en.wikipedia.org" };
  private readonly shapes = new Map<string, DocShape>();
  private readonly frozen = new Set<string>();

  set(frame: FrameRef, shape: DocShape): void {
    this.shapes.set(frameKey(frame), shape);
  }

  freeze(frame: FrameRef): void {
    this.frozen.add(frameKey(frame));
  }

  async classify(): Promise<DocStats> {
    return statsFor(this.shapes.get(frameKey(this.target)) ?? "shell");
  }

  async waitReady(_budget: Ms): Promise<DocStats> {
    const key = frameKey(this.target);
    if (!this.frozen.has(key) && (this.shapes.get(key) ?? "shell") === "shell") {
      this.shapes.set(key, "injected");
    }
    return this.classify();
  }
}

export class FakeFrameGraph implements FrameGraph {
  nodes: FrameNode[] = [];
  focused: FrameRef | undefined;
  autoAttach = false;

  async list(_tab: TabId): Promise<FrameNode[]> {
    return this.nodes;
  }

  focus(frame: FrameRef): void {
    this.focused = frame;
  }

  async autoAttachChildTargets(on: boolean): Promise<void> {
    this.autoAttach = on;
  }
}

export class FakeRelatedTargets implements RelatedTargets {
  tabs: Tab[] = [];

  async pages(): Promise<Tab[]> {
    return this.tabs;
  }
}

function emptyStorage(): RawStorageItems {
  return { localStorage: {}, sessionStorage: {}, indexedDb: {} };
}

export class FakeCredentialStore implements CredentialStorePort {
  cookies = new Map<Origin, RawCookie[]>();
  storage = new Map<Origin, RawStorageItems>();
  readCookieCalls = 0;
  readStorageCalls = 0;
  writeCookieCalls: Origin[] = [];
  writeStorageCalls: Origin[] = [];

  seed(origin: Origin, cookies: RawCookie[], items: RawStorageItems): void {
    this.cookies.set(origin, cookies);
    this.storage.set(origin, items);
  }

  async readCookies(origin: Origin): Promise<RawCookie[]> {
    this.readCookieCalls += 1;
    return this.cookies.get(origin) ?? [];
  }

  async writeCookies(origin: Origin, cookies: RawCookie[]): Promise<void> {
    this.writeCookieCalls.push(origin);
    this.cookies.set(origin, cookies);
  }

  async readStorage(origin: Origin): Promise<RawStorageItems> {
    this.readStorageCalls += 1;
    return this.storage.get(origin) ?? emptyStorage();
  }

  async writeStorage(origin: Origin, items: RawStorageItems): Promise<void> {
    this.writeStorageCalls.push(origin);
    this.storage.set(origin, items);
  }

  async clearCookies(origin: Origin): Promise<void> {
    this.cookies.delete(origin);
  }
}
