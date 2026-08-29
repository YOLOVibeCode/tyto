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

function loopOf(over: {
  model?: FakeModel;
  occupancy?: FakeOccupancy;
  actuation?: FakeActuation;
  store?: MemorySessionStore;
} = {}): AgentLoop {
  return new AgentLoop({
    store: over.store ?? new MemorySessionStore(),
    occupancy: over.occupancy ?? new FakeOccupancy(),
    actuation: over.actuation ?? new FakeActuation(),
    model: over.model ?? new FakeModel(),
    redactor: new SecretRedactor(),
    perception: new FakePerception(),
    clock: new FakeClock(),
  });
}

describe("AgentLoop", () => {
  it("limit: AgentLoop calls ModelPort at most twice per page generation", async () => {
    const model = new FakeModel();
    const loop = loopOf({ model });
    const session = emptySession("s1", "find owl");
    const snap = compactAx(
      [{ nodeId: "1", role: { value: "WebArea" }, name: { value: "Home" } }],
      { generation: 1, origin: "https://ex.test", url: "https://ex.test/", title: "x" },
    );
    await loop.think(session, snap);
    await loop.think(session, snap);
    await loop.think(session, snap);
    expect(model.calls).toBe(2);
  });

  it("operatorActive true: loop does not call Actuation.perform", async () => {
    const occupancy = new FakeOccupancy();
    occupancy.active = true;
    const actuation = new FakeActuation();
    const loop = loopOf({ occupancy, actuation, store: new MemorySessionStore() });
    const session = emptySession("s1", "x");
    session.remainingSteps = [{ op: "click", role: "button", name: "Go" }];
    const snap = compactAx(
      [
        { nodeId: "1", childIds: ["2"], role: { value: "WebArea" }, name: { value: "Home" } },
        { nodeId: "2", parentId: "1", role: { value: "button" }, name: { value: "Go" }, backendDOMNodeId: 7 },
      ],
      { generation: 1, origin: "https://ex.test", url: "https://ex.test/", title: "x" },
    );
    await loop.act(session, snap, { tabId: "t", frameId: "f", origin: "https://ex.test" });
    expect(actuation.performed).toHaveLength(0);
  });

  it("KILL client: SessionStore still has plan after loop.stop()", async () => {
    const store = new MemorySessionStore();
    const occupancy = new FakeOccupancy();
    const loop = loopOf({ store, occupancy });
    const session = emptySession("s1", "goal");
    session.plan = { rationale: "x", anchors: [], steps: [{ op: "done", reason: "ok" }] };
    await store.save(session);
    loop.stop();
    expect(occupancy.interrupted).toBe(true);
    expect((await store.load("s1"))?.plan?.steps[0]?.op).toBe("done");
  });

  it("AgentLoop: Redactor.prompt called before every ModelPort.complete", async () => {
    const model = new FakeModel();
    const loop = loopOf({ model });
    const session = emptySession("s1", "Cookie: sessionid=shouldneverreachmodel");
    const snap = compactAx(
      [{ nodeId: "1", role: { value: "WebArea" }, name: { value: "Home" } }],
      { generation: 1, origin: "https://ex.test", url: "https://ex.test/", title: "x" },
    );
    await loop.think(session, snap);
    expect(model.last?.user).not.toContain("shouldneverreachmodel");
  });

  it("trusted click records frameRef of the focused frame", async () => {
    const actuation = new FakeActuation();
    const loop = loopOf({ actuation });
    const session = emptySession("s1", "x");
    session.remainingSteps = [{ op: "click", role: "button", name: "Go" }];
    const snap = compactAx(
      [
        { nodeId: "1", childIds: ["2"], role: { value: "WebArea" }, name: { value: "App" } },
        { nodeId: "2", parentId: "1", role: { value: "button" }, name: { value: "Go" }, backendDOMNodeId: 44 },
      ],
      { generation: 1, origin: "https://wd5.myworkday.com", url: "https://wd5.myworkday.com/", title: "wd" },
    );
    const frame = { tabId: "t", frameId: "child", origin: "https://wd5.myworkday.com" };
    await loop.act(session, snap, frame);
    expect(actuation.performed[0]?.frame.frameId).toBe("child");
    expect(actuation.performed[0]?.node).toBe(44);
  });
});
