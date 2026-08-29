import { describe, expect, it } from "vitest";
import { compactAx } from "../src/ax/compact.ts";
import { AgentLoop } from "../src/loop/agent-loop.ts";
import { SecretRedactor } from "../src/identity/redact.ts";
import { emptySession } from "../src/session/schema.ts";
import {
  FakeActuation,
  FakeClock,
  FakeModel,
  FakeOccupancy,
  FakePerception,
  MemorySessionStore,
} from "../src/testing/fakes.ts";
import type { AxNode, AxSnapshot, FrameRef } from "../src/types.ts";

const FRAME: FrameRef = { tabId: "t", frameId: "f", origin: "https://ex.test" };

const NODES: AxNode[] = [
  { nodeId: "1", childIds: ["2"], role: { value: "WebArea" }, name: { value: "Home" } },
  { nodeId: "2", parentId: "1", role: { value: "button" }, name: { value: "Go" }, backendDOMNodeId: 7 },
];

function buttonSnap(): AxSnapshot {
  return compactAx(NODES, { generation: 1, origin: "https://ex.test", url: "https://ex.test/", title: "x" });
}

function harness(occupancy = new FakeOccupancy(), actuation = new FakeActuation()) {
  const model = new FakeModel();
  const perception = new FakePerception();
  const clock = new FakeClock();
  perception.currentUrl = "https://ex.test/";
  perception.seedUrl("https://ex.test/", NODES, "Home");
  const loop = new AgentLoop({
    store: new MemorySessionStore(),
    occupancy,
    actuation,
    model,
    redactor: new SecretRedactor(),
    perception,
    clock,
  });
  const session = emptySession("s1", "x");
  session.remainingSteps = [{ op: "click", role: "button", name: "Go" }];
  return { loop, session, occupancy, actuation, model, snap: buttonSnap(), perception, clock };
}

describe("weave occupancy", () => {
  it("FakeOccupancy: key event sets operatorActive; next tick no perform", async () => {
    const { loop, session, occupancy, actuation, snap } = harness();
    occupancy.noteInput();
    expect(occupancy.operatorActive()).toBe(true);
    await loop.act(session, snap, FRAME);
    expect(actuation.performed).toHaveLength(0);
    expect(loop.phase).toBe("idle");
  });

  it("occupancy.interrupt (Esc / Stop) halts the loop so later ticks still do not perform", async () => {
    const { loop, session, occupancy, actuation, snap } = harness();
    occupancy.interrupt();
    await loop.act(session, snap, FRAME);
    expect(actuation.performed).toHaveLength(0);
    occupancy.active = false;
    await loop.act(session, snap, FRAME);
    expect(actuation.performed).toHaveLength(0);
    expect(loop.phase).toBe("idle");
  });

  it("Esc → Idle", async () => {
    const { loop, occupancy, actuation, session, snap } = harness();
    occupancy.noteInput();
    expect(loop.phase).toBe("idle");
    loop.stop();
    expect(occupancy.interrupted).toBe(true);
    expect(occupancy.operatorActive()).toBe(false);
    expect(loop.phase).toBe("idle");
    await loop.act(session, snap, FRAME);
    expect(actuation.performed).toHaveLength(0);
  });

  it("interrupt mid-act: state Idle, refs dropped", async () => {
    const actuation = new FakeActuation();
    const occupancy = new FakeOccupancy();
    const { loop, session, snap } = harness(occupancy, actuation);
    actuation.perform = async () => {
      loop.stop();
    };
    await loop.act(session, snap, FRAME);
    expect(loop.phase).toBe("idle");
    expect(loop.ephemeralRefs).toBeNull();
    expect(session.remainingSteps).toHaveLength(1);
  });

  it("Illegal: Thinking while operatorActive", async () => {
    const { loop, session, occupancy, model, snap } = harness();
    occupancy.noteInput();
    await loop.think(session, snap);
    expect(model.calls).toBe(0);
    expect(loop.phase).toBe("idle");
  });

  it("when you pause, play resumes from a fresh snapshot and performs", async () => {
    const { loop, session, occupancy, actuation, snap, perception, clock } = harness();
    occupancy.noteInput();
    const genBefore = perception.generation;
    const playing = loop.play(session, snap, FRAME);
    expect(actuation.performed).toHaveLength(0);
    occupancy.active = false;
    clock.advance(50);
    await playing;
    expect(actuation.performed).toHaveLength(1);
    expect(perception.generation).toBeGreaterThan(genBefore);
  });

  it("Esc during yield wait does not resume perform", async () => {
    const { loop, session, occupancy, actuation, snap, clock } = harness();
    occupancy.noteInput();
    const playing = loop.play(session, snap, FRAME);
    occupancy.interrupt();
    clock.advance(50);
    await playing;
    expect(actuation.performed).toHaveLength(0);
  });
});
