import { describe, expect, it } from "vitest";
import { compactAx } from "../src/ax/compact.ts";
import { extractOrThrow, ShellNotReady } from "../src/ax/extract.ts";
import { waitForTape } from "../src/loop/wait.ts";
import { bind } from "../src/recipe/bind.ts";
import { emptySession } from "../src/session/schema.ts";
import { makeLoopHarness } from "../src/testing/harness.ts";
import { FakeClock, FakeObservation } from "../src/testing/fakes.ts";
import type { AxNode, FrameRef } from "../src/types.ts";

const WIKI = "https://en.wikipedia.org";
const SEARCH_URL = `${WIKI}/wiki/Main_Page`;
const ARTICLE_URL = `${WIKI}/wiki/Barn_owl`;
const FRAME: FrameRef = { tabId: "t", frameId: "main", origin: WIKI };

const SEARCH_NODES: AxNode[] = [
  { nodeId: "1", childIds: ["2", "3"], role: { value: "WebArea" }, name: { value: "Wikipedia" } },
  {
    nodeId: "2",
    parentId: "1",
    role: { value: "searchbox" },
    name: { value: "Search Wikipedia" },
    backendDOMNodeId: 42,
  },
  {
    nodeId: "3",
    parentId: "1",
    role: { value: "button" },
    name: { value: "Search" },
    backendDOMNodeId: 43,
  },
];

const ARTICLE_NODES: AxNode[] = [
  { nodeId: "1", childIds: ["2", "3"], role: { value: "WebArea" }, name: { value: "Barn owl" } },
  { nodeId: "2", parentId: "1", role: { value: "heading" }, name: { value: "Conservation status" } },
  { nodeId: "3", parentId: "1", role: { value: "statictext" }, name: { value: "Least Concern" } },
];

const WIKI_PLAN = {
  text: JSON.stringify({
    rationale: "search then extract",
    anchors: [],
    steps: [
      { op: "click", role: "button", name: "Search" },
      { op: "fill", role: "searchbox", name: "Search Wikipedia", text: "barn owl" },
      { op: "press", key: "Enter" },
    ],
  }),
};

describe("Slice 6 AgentLoop against fakes", () => {
  it("paste goal on wikipedia-like search: think once, click Search, fill, press Enter", async () => {
    const h = makeLoopHarness();
    h.perception.seedUrl(SEARCH_URL, SEARCH_NODES, "Wikipedia");
    h.model.canned = WIKI_PLAN;
    const session = emptySession("owl", "barn owl conservation status");
    const snap = await h.perception.snapshot(FRAME);
    await h.loop.play(session, snap, FRAME);
    expect(h.model.calls).toBe(1);
    expect(h.actuation.performed.map((p) => p.op)).toEqual(["click", "fill", "press"]);
    expect(h.actuation.performed[0]?.node).toBe(43);
    expect(h.actuation.performed[1]?.text).toBe("barn owl");
    expect(h.actuation.performed[2]?.key).toBe("Enter");
  });

  it("after nav, snapshot generation increments; old refs do not bind", async () => {
    const h = makeLoopHarness();
    h.perception.seedUrl(SEARCH_URL, SEARCH_NODES, "Wikipedia");
    h.perception.seedUrl(ARTICLE_URL, ARTICLE_NODES, "Barn owl");
    const before = await h.perception.snapshot(FRAME);
    const old = before.refs.get("ref_2");
    expect(old?.name).toBe("Search");
    await h.navigation.goto(new URL(ARTICLE_URL));
    const after = await h.perception.snapshot(FRAME);
    expect(after.generation).toBeGreaterThan(before.generation);
    expect(bind({ op: "click", role: "button", name: "Search", ref: "ref_2" }, after)).toBeNull();
    expect([...after.refs.values()].some((r) => r.backendNodeId === old?.backendNodeId)).toBe(false);
  });

  it("WAIT completes on nav tape event, not on Clock.sleep(250) as the success path", async () => {
    const clock = new FakeClock();
    const obs = new FakeObservation();
    const ok = waitForTape(obs, (e) => e.kind === "nav", 250, clock);
    obs.push("nav", ARTICLE_URL);
    await expect(ok).resolves.toBe("ok");
    expect(clock.t).toBe(0);

    const clock2 = new FakeClock();
    const obs2 = new FakeObservation();
    const timed = waitForTape(obs2, (e) => e.kind === "nav", 250, clock2);
    clock2.advance(250);
    await expect(timed).resolves.toBe("timeout");
  });

  it("shell page: waitReady then inject; extract succeeds", async () => {
    const h = makeLoopHarness();
    h.readiness.set(FRAME, "shell");
    expect((await h.readiness.classify()).shape).toBe("shell");
    const shellSnap = compactAx(
      [{ nodeId: "1", role: { value: "WebArea" }, name: { value: "Loading" } }],
      { generation: 1, origin: "https://app.test", url: "https://app.test/", title: "x" },
    );
    expect(() => extractOrThrow("shell", shellSnap, "status")).toThrow(ShellNotReady);
    await h.readiness.waitReady(5_000);
    expect((await h.readiness.classify()).shape).toBe("injected");
    const injected = compactAx(ARTICLE_NODES, {
      generation: 2,
      origin: WIKI,
      url: ARTICLE_URL,
      title: "Barn owl",
    });
    const extracted = extractOrThrow("injected", injected, "conservation status");
    expect(extracted.ok).toBe(true);
    if (extracted.ok) expect(extracted.text).toMatch(/Least Concern/i);
    expect(h.model.calls).toBe(0);
  });

  it("shell page that never grows: extract blocked; FakeModel.complete call count 0 for extract", async () => {
    const h = makeLoopHarness();
    h.readiness.set(FRAME, "shell");
    h.readiness.freeze(FRAME);
    await h.readiness.waitReady(5_000);
    expect((await h.readiness.classify()).shape).toBe("shell");
    const shellSnap = compactAx(
      [{ nodeId: "1", role: { value: "WebArea" }, name: { value: "Loading" } }],
      { generation: 1, origin: "https://app.test", url: "https://app.test/", title: "x" },
    );
    expect(() => extractOrThrow("shell", shellSnap, "conservation status")).toThrow(ShellNotReady);
    expect(h.model.calls).toBe(0);
  });

  it("recipe replay: second visit same origin skips ModelPort when bind hits", async () => {
    const h = makeLoopHarness();
    h.perception.seedUrl(SEARCH_URL, SEARCH_NODES, "Wikipedia");
    h.model.canned = WIKI_PLAN;
    const session = emptySession("owl", "search");
    const snap = await h.perception.snapshot(FRAME);
    await h.loop.play(session, snap, FRAME);
    expect(h.model.calls).toBe(1);
    for (const r of snap.recipes) h.archive.remember(snap.origin, r);

    const again = emptySession("owl-2", "search again");
    const rec = h.archive.lookup(WIKI, "button", "Search");
    expect(rec).toBeTruthy();
    again.remainingSteps = [{ op: "click", role: "button", name: "Search" }];
    const snap2 = await h.perception.snapshot(FRAME);
    await h.loop.play(again, snap2, FRAME);
    expect(h.model.calls).toBe(1);
    expect(h.actuation.performed.at(-1)?.op).toBe("click");
  });
});
