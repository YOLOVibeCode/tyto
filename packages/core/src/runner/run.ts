import { AgentLoop } from "../loop/agent-loop.ts";
import { extractOrThrow } from "../ax/extract.ts";
import { classifyStats } from "../ready/classify.ts";
import type { Allowlist } from "../ports/allowlist.ts";
import type { Actuation } from "../ports/actuation.ts";
import type { ConfirmGate } from "../ports/confirm-gate.ts";
import type { ModelPort } from "../ports/model.ts";
import type { Navigation } from "../ports/navigation.ts";
import type { Occupancy } from "../ports/occupancy.ts";
import type { Operator } from "../ports/operator.ts";
import type { Perception } from "../ports/perception.ts";
import type { Redactor } from "../ports/redactor.ts";
import type { SessionStore } from "../ports/session-store.ts";
import type { FrameRef, Intent, Session, Step } from "../types.ts";
import { unattendedExit, type UnattendedOpts } from "./exit.ts";

export type UnattendedDeps = {
  store: SessionStore;
  occupancy: Occupancy;
  actuation: Actuation;
  model: ModelPort;
  redactor: Redactor;
  allowlist: Allowlist;
  navigation: Navigation;
  perception: Perception;
  confirm: ConfirmGate;
};

export function parseRunnerArgs(argv: string[]): { sessionId: string; allowConfirmFail: boolean } {
  let sessionId = "";
  let allowConfirmFail = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--allow-confirm-fail") allowConfirmFail = true;
    if (a === "--no-confirm") allowConfirmFail = false;
    if (a === "--session" && argv[i + 1]) {
      sessionId = argv[i + 1] ?? "";
      i += 1;
    } else if (a && !a.startsWith("-") && !sessionId) {
      sessionId = a;
    }
  }
  return { sessionId, allowConfirmFail };
}

export function intentFromStep(step: Step): Intent | null {
  if (step.op !== "click" && step.op !== "fill") return null;
  const name = step.name.toLowerCase();
  const base = { name: step.name, role: step.role };
  if (name === "purchase" || name.includes("purchase")) return { kind: "purchase", ...base };
  if (name === "delete" || name.includes("delete")) return { kind: "delete", ...base };
  if (name === "send" || name.includes("send")) return { kind: "send", ...base };
  if (name === "submit" || name.includes("submit")) return { kind: "submit", ...base };
  return { kind: step.op, ...base };
}

export async function runUnattended(
  session: Session,
  frame: FrameRef,
  opts: UnattendedOpts,
  deps: UnattendedDeps,
  operator: Operator,
): Promise<number> {
  if (session.lastUrl) {
    let url: URL;
    try {
      url = new URL(session.lastUrl);
    } catch {
      return unattendedExit({ kind: "deny" }, opts, deps.confirm, operator);
    }
    if (!deps.allowlist.permits(url)) {
      return unattendedExit({ kind: "deny" }, opts, deps.confirm, operator);
    }
    await deps.navigation.goto(url);
  }

  const snap = await deps.perception.snapshot(frame);
  const first = session.remainingSteps[0];
  if (first?.op === "extract") {
    const stats = classifyStats({
      textLen: snap.tree.length,
      elements: 1,
      tables: 0,
      mainLen: snap.tree.length,
      axNodes: snap.refs.size,
      textStart: snap.tree,
      htmlHead: snap.tree,
    });
    try {
      extractOrThrow(stats.shellMarker ? "shell" : stats.shape, snap, first.query);
    } catch (error) {
      return unattendedExit({ kind: "error", error }, opts, deps.confirm, operator);
    }
  }

  for (const step of session.remainingSteps) {
    const intent = intentFromStep(step);
    if (intent && deps.confirm.mustConfirm(intent) && !opts.allowConfirmFail) {
      return unattendedExit({ kind: "confirm", intent }, opts, deps.confirm, operator);
    }
  }

  const loop = new AgentLoop({
    store: deps.store,
    occupancy: deps.occupancy,
    actuation: deps.actuation,
    model: deps.model,
    redactor: deps.redactor,
  });
  try {
    await loop.play(session, snap, frame);
  } finally {
    loop.release();
  }
  return unattendedExit({ kind: "done" }, opts, deps.confirm, operator);
}
