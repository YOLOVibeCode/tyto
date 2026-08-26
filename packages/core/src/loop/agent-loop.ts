import type { Actuation } from "../ports/actuation.ts";
import type { ModelPort } from "../ports/model.ts";
import type { Occupancy } from "../ports/occupancy.ts";
import type { Redactor } from "../ports/redactor.ts";
import type { SessionStore } from "../ports/session-store.ts";
import { coercePlan } from "../plan/coerce.ts";
import type { AxSnapshot, FrameRef, Session, TrustedIntent } from "../types.ts";
import { bind } from "../recipe/bind.ts";

export type LoopDeps = {
  store: SessionStore;
  occupancy: Occupancy;
  actuation: Actuation;
  model: ModelPort;
  redactor: Redactor;
};

export class AgentLoop {
  thinkCount = 0;
  constructor(private readonly deps: LoopDeps) {}

  async think(session: Session, snap: AxSnapshot): Promise<void> {
    if (this.deps.occupancy.operatorActive()) return;
    if (this.thinkCount >= 2) return;
    this.thinkCount += 1;
    const req = this.deps.redactor.prompt({
      system: "plan",
      user: session.goal,
      page: { kind: "untrusted", text: snap.tree },
    });
    const res = await this.deps.model.complete(req);
    const plan = coercePlan(res.text);
    if (plan) {
      session.plan = plan;
      session.remainingSteps = plan.steps;
    }
    await this.deps.store.save(session);
  }

  async act(session: Session, snap: AxSnapshot, frame: FrameRef): Promise<void> {
    if (this.deps.occupancy.operatorActive()) return;
    const step = session.remainingSteps[0];
    if (!step || step.op === "done" || step.op === "extract" || step.op === "press") return;
    const target = bind(step, snap);
    if (!target || target === "ok") return;
    const intent: TrustedIntent = {
      op: step.op === "fill" ? "fill" : "click",
      node: target.backendNodeId,
      frame,
      ...(step.op === "fill" ? { text: step.text } : {}),
    };
    await this.deps.actuation.perform(intent);
    session.remainingSteps = session.remainingSteps.slice(1);
    await this.deps.store.save(session);
  }

  stop(): void {
    this.deps.occupancy.interrupt();
  }
}
