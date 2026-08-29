import { AgentLoop } from "../loop/agent-loop.ts";
import { OriginAllowlist } from "../policy/allow.ts";
import { SecretRedactor } from "../identity/redact.ts";
import { MemoryRecipeArchive } from "../recipe/bind.ts";
import type { FrameRef } from "../types.ts";
import {
  FakeActuation,
  FakeClock,
  FakeFrameGraph,
  FakeModel,
  FakeNavigation,
  FakeObservation,
  FakeOccupancy,
  FakePerception,
  FakeReadiness,
  FakeRelatedTargets,
  MemorySessionStore,
} from "./fakes.ts";

export type LoopHarness = {
  store: MemorySessionStore;
  occupancy: FakeOccupancy;
  actuation: FakeActuation;
  model: FakeModel;
  observation: FakeObservation;
  clock: FakeClock;
  perception: FakePerception;
  navigation: FakeNavigation;
  readiness: FakeReadiness;
  frames: FakeFrameGraph;
  related: FakeRelatedTargets;
  archive: MemoryRecipeArchive;
  allowlist: OriginAllowlist;
  loop: AgentLoop;
  frame: FrameRef;
};

/** Test-only factory. Production never uses a combined fake type. */
export function makeLoopHarness(): LoopHarness {
  const store = new MemorySessionStore();
  const occupancy = new FakeOccupancy();
  const actuation = new FakeActuation();
  const model = new FakeModel();
  const observation = new FakeObservation();
  const clock = new FakeClock();
  const perception = new FakePerception();
  const navigation = new FakeNavigation(perception, observation);
  const readiness = new FakeReadiness();
  const frames = new FakeFrameGraph();
  const related = new FakeRelatedTargets();
  const archive = new MemoryRecipeArchive();
  const allowlist = new OriginAllowlist();
  const frame: FrameRef = { tabId: "t", frameId: "main", origin: "https://en.wikipedia.org" };
  perception.currentUrl = "https://en.wikipedia.org/wiki/Main_Page";
  readiness.target = frame;
  const loop = new AgentLoop({
    store,
    occupancy,
    actuation,
    model,
    redactor: new SecretRedactor(),
    perception,
    clock,
  });
  return {
    store,
    occupancy,
    actuation,
    model,
    observation,
    clock,
    perception,
    navigation,
    readiness,
    frames,
    related,
    archive,
    allowlist,
    loop,
    frame,
  };
}
