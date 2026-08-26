import type { Actuation } from "../ports/actuation.ts";
import type { Clock } from "../ports/clock.ts";
import type { ModelPort } from "../ports/model.ts";
import type { Occupancy } from "../ports/occupancy.ts";
import type { SessionStore } from "../ports/session-store.ts";
import type {
  CompleteRequest,
  CompleteResponse,
  Session,
  SessionId,
  SessionSummary,
  TapeEvent,
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
  now(): number {
    return this.t;
  }
  async sleep(ms: number): Promise<void> {
    this.sleeps += 1;
    this.t += ms;
  }
}

export class FakeOccupancy implements Occupancy {
  active = false;
  interrupted = false;
  private readonly listeners = new Set<() => void>();

  /** Simulate a real key or mouse from the operator. */
  noteInput(): void {
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

export class FakeObservation {
  events: TapeEvent[] = [];
  subscribe(fn: (e: TapeEvent) => void): Unsubscribe {
    return () => void fn;
  }
  recent(n: number): TapeEvent[] {
    return this.events.slice(-n);
  }
  push(kind: TapeEvent["kind"], detail: string): void {
    this.events.push({ t: this.events.length, kind, detail });
  }
}
