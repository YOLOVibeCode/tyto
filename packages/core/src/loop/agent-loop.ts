import type { Actuation } from "../ports/actuation.ts";
import type { Clock } from "../ports/clock.ts";
import type { ModelPort } from "../ports/model.ts";
import type { Occupancy } from "../ports/occupancy.ts";
import type { Perception } from "../ports/perception.ts";
import type { Redactor } from "../ports/redactor.ts";
import type { SessionStore } from "../ports/session-store.ts";
import { coercePlan } from "../plan/coerce.ts";
import type { AxSnapshot, FrameRef, RefEntry, Session, Step, TrustedIntent, Unsubscribe } from "../types.ts";
import { bind } from "../recipe/bind.ts";

export type LoopPhase = "idle" | "thinking" | "acting";

export type LoopDeps = {
  store: SessionStore;
  occupancy: Occupancy;
  actuation: Actuation;
  model: ModelPort;
  redactor: Redactor;
  perception: Perception;
  clock: Clock;
};

const OCCUPANCY_POLL_MS = 25;

export class AgentLoop {
  thinkCount = 0;
  phase: LoopPhase = "idle";
  ephemeralRefs: Map<string, RefEntry> | null = null;
  private halted = false;
  private pageGeneration: number | undefined;
  private readonly unsub: Unsubscribe;

  constructor(private readonly deps: LoopDeps) {
    this.unsub = deps.occupancy.onOperatorInput(() => {
      this.phase = "idle";
      this.ephemeralRefs = null;
      if (!this.deps.occupancy.operatorActive()) this.halted = true;
    });
  }

  async play(session: Session, snap: AxSnapshot, frame: FrameRef): Promise<void> {
    let current = snap;
    if (!this.canReplay(session, current)) {
      await this.think(session, current);
    }
    while (isActable(session.remainingSteps[0])) {
      if (this.halted) break;
      if (this.deps.occupancy.operatorActive()) {
        await this.waitWhileOccupied();
        if (this.halted) break;
        current = await this.deps.perception.snapshot(frame);
        if (!this.canReplay(session, current)) {
          await this.think(session, current);
        }
        continue;
      }
      const n = session.remainingSteps.length;
      await this.act(session, current, frame);
      if (session.remainingSteps.length === n) break;
    }
  }

  async think(session: Session, snap: AxSnapshot): Promise<void> {
    if (this.pageGeneration !== snap.generation) {
      this.pageGeneration = snap.generation;
      this.thinkCount = 0;
    }
    if (this.shouldYield()) {
      this.phase = "idle";
      return;
    }
    if (this.thinkCount >= 2) return;
    this.phase = "thinking";
    this.thinkCount += 1;
    const req = this.deps.redactor.prompt({
      system: "plan",
      user: session.goal,
      page: { kind: "untrusted", text: snap.tree },
    });
    const res = await this.deps.model.complete(req);
    if (this.shouldYield()) {
      this.phase = "idle";
      return;
    }
    const plan = coercePlan(res.text);
    if (plan) {
      session.plan = plan;
      session.remainingSteps = plan.steps;
    }
    await this.deps.store.save(session);
    this.phase = "idle";
  }

  async act(session: Session, snap: AxSnapshot, frame: FrameRef): Promise<void> {
    if (this.shouldYield()) {
      this.phase = "idle";
      this.ephemeralRefs = null;
      return;
    }
    const step = session.remainingSteps[0];
    if (!step || step.op === "done" || step.op === "extract") {
      this.phase = "idle";
      return;
    }
    if (step.op === "press") {
      this.phase = "acting";
      await this.deps.actuation.perform({ op: "press", key: step.key, frame });
      if (this.shouldYield()) {
        this.phase = "idle";
        this.ephemeralRefs = null;
        return;
      }
      session.remainingSteps = session.remainingSteps.slice(1);
      await this.deps.store.save(session);
      this.phase = "idle";
      return;
    }
    const target = bind(step, snap);
    if (!target || target === "ok") {
      this.phase = "idle";
      return;
    }
    this.phase = "acting";
    this.ephemeralRefs = snap.refs;
    const intent: TrustedIntent = {
      op: step.op === "fill" ? "fill" : "click",
      node: target.backendNodeId,
      frame,
      ...(step.op === "fill" ? { text: step.text } : {}),
    };
    await this.deps.actuation.perform(intent);
    if (this.shouldYield()) {
      this.phase = "idle";
      this.ephemeralRefs = null;
      return;
    }
    session.remainingSteps = session.remainingSteps.slice(1);
    this.ephemeralRefs = null;
    await this.deps.store.save(session);
    this.phase = "idle";
  }

  stop(): void {
    this.halted = true;
    this.phase = "idle";
    this.ephemeralRefs = null;
    this.deps.occupancy.interrupt();
    this.unsub();
  }

  /** Drop occupancy subscription without interrupting the operator. */
  release(): void {
    this.unsub();
  }

  private shouldYield(): boolean {
    return this.halted || this.deps.occupancy.operatorActive();
  }

  private async waitWhileOccupied(): Promise<void> {
    while (!this.halted && this.deps.occupancy.operatorActive()) {
      await this.deps.clock.sleep(OCCUPANCY_POLL_MS);
    }
  }

  private canReplay(session: Session, snap: AxSnapshot): boolean {
    const steps = session.remainingSteps;
    if (steps.length === 0) return false;
    return steps.every((s) => bind(s, snap) !== null);
  }
}

function isActable(step: Step | undefined): boolean {
  return step?.op === "click" || step?.op === "fill" || step?.op === "press";
}
