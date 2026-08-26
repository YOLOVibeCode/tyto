import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compactAx, type AxNode, type FrameRef, type TrustedIntent } from "@tyto/core";
import { FakeObservation } from "@tyto/core/testing";
import {
  CdpActuation,
  CdpFrameGraph,
  CdpPerception,
  CdpReadiness,
  chromeLaunchArgs,
  LocalStateProfileCatalog,
} from "../src/index.ts";
import { ScriptedCdp } from "./scripted-cdp.ts";

const FIXTURES = fileURLToPath(new URL("../fixtures", import.meta.url));
const SRC = fileURLToPath(new URL("../src", import.meta.url));

const MAIN: FrameRef = { tabId: "t", frameId: "main", origin: "https://en.wikipedia.org" };
const CHILD: FrameRef = { tabId: "t", frameId: "child", origin: "https://wd5.myworkday.com" };

const PARENT_BOX = { model: { content: [900, 800, 940, 800, 940, 860, 900, 860] } };
const CHILD_BOX = { model: { content: [20, 40, 30, 40, 30, 50, 20, 50] } };

function wikiFixture(): { nodes: AxNode[]; origin: string; url: string; title: string; generation: number } {
  return JSON.parse(readFileSync(join(FIXTURES, "ax/wikipedia-search.json"), "utf8")) as {
    nodes: AxNode[];
    origin: string;
    url: string;
    title: string;
    generation: number;
  };
}

describe("cdp adapter", () => {
  it("compactAx(fixture) matches golden tree", () => {
    const fix = wikiFixture();
    const snap = compactAx(fix.nodes, {
      generation: fix.generation,
      origin: fix.origin,
      url: fix.url,
      title: fix.title,
    });
    const golden = readFileSync(join(FIXTURES, "ax/wikipedia-search.tree.txt"), "utf8").trim();
    expect(snap.tree).toBe(golden);
    expect(snap.refs.get("ref_1")?.name).toBe("Search Wikipedia");
  });

  it("trusted click: send DOM.getBoxModel then Input.dispatchMouseEvent down/up", async () => {
    const wire = new ScriptedCdp();
    wire.handlers.set("DOM.getBoxModel", () => PARENT_BOX);
    const act = new CdpActuation(wire);
    const intent: TrustedIntent = { op: "click", node: 42, frame: MAIN };
    await act.perform(intent);
    const names = wire.calls.map((c) => c.method);
    const boxAt = names.indexOf("DOM.getBoxModel");
    const pressAt = names.findIndex(
      (m, i) => m === "Input.dispatchMouseEvent" && (wire.calls[i]?.params as { type?: string }).type === "mousePressed",
    );
    const releaseAt = names.findIndex(
      (m, i) => m === "Input.dispatchMouseEvent" && (wire.calls[i]?.params as { type?: string }).type === "mouseReleased",
    );
    expect(boxAt).toBeGreaterThanOrEqual(0);
    expect(pressAt).toBeGreaterThan(boxAt);
    expect(releaseAt).toBeGreaterThan(pressAt);
    expect(wire.calls[pressAt]?.params).toMatchObject({ button: "left", clickCount: 1 });
    expect(wire.calls.find((c) => c.method === "DOM.getBoxModel")?.params).toEqual({ backendNodeId: 42 });
  });

  it("trusted click does not send Runtime.evaluate with .click()", async () => {
    const wire = new ScriptedCdp();
    await new CdpActuation(wire).perform({ op: "click", node: 42, frame: MAIN });
    const evals = wire.calls.filter((c) => c.method === "Runtime.evaluate");
    expect(evals).toHaveLength(0);
    expect(JSON.stringify(wire.calls)).not.toMatch(/\.click\s*\(/);
  });

  it("Accessibility.getFullAXTree per frame; missing OOPIF does not throw, logs tape", async () => {
    const wire = new ScriptedCdp();
    const wiki = wikiFixture();
    wire.handlers.set("Accessibility.getFullAXTree", (_p, sessionId) => {
      if (sessionId === "gone") throw new Error("session closed");
      return { nodes: wiki.nodes };
    });
    const tape = new FakeObservation();
    const perception = new CdpPerception(wire, tape, (frame) => (frame.frameId === "child" ? "gone" : undefined));
    const main = await perception.snapshot(MAIN);
    expect(main.tree).toContain("Search Wikipedia");
    expect(wire.calls.filter((c) => c.method === "Accessibility.getFullAXTree")).toHaveLength(1);
    await expect(perception.snapshot(CHILD)).resolves.toMatchObject({ tree: "" });
    expect(tape.recent(5).some((e) => e.kind === "frame" && /empty|oopif|missing/i.test(e.detail))).toBe(true);
  });

  it("Target.setAutoAttach flatten=true; child session used for click box model", async () => {
    const wire = new ScriptedCdp();
    wire.handlers.set("sid-child:DOM.getBoxModel", () => CHILD_BOX);
    wire.handlers.set("DOM.getBoxModel", () => PARENT_BOX);
    const frames = new CdpFrameGraph(wire);
    await frames.autoAttachChildTargets(true);
    const attach = wire.calls.find((c) => c.method === "Target.setAutoAttach");
    expect(attach?.params).toMatchObject({ autoAttach: true, flatten: true });
    frames.attachSession("child", "sid-child");
    const act = new CdpActuation(wire, (f) => frames.sessionId(f));
    await act.perform({ op: "click", node: 7, frame: CHILD });
    const box = wire.calls.find((c) => c.method === "DOM.getBoxModel");
    expect(box?.sessionId).toBe("sid-child");
  });

  it("click in child uses child Input.dispatchMouseEvent, not parent coordinates", async () => {
    const wire = new ScriptedCdp();
    wire.handlers.set("sid-child:DOM.getBoxModel", () => CHILD_BOX);
    wire.handlers.set("DOM.getBoxModel", () => PARENT_BOX);
    const frames = new CdpFrameGraph(wire);
    frames.attachSession("child", "sid-child");
    const act = new CdpActuation(wire, (f) => frames.sessionId(f));
    await act.perform({ op: "click", node: 7, frame: CHILD });
    const mouse = wire.calls.filter((c) => c.method === "Input.dispatchMouseEvent");
    expect(mouse.length).toBeGreaterThanOrEqual(2);
    for (const ev of mouse) {
      expect(ev.sessionId).toBe("sid-child");
      expect(ev.params).toMatchObject({ x: 25, y: 45 });
      expect(ev.params).not.toMatchObject({ x: 920, y: 830 });
    }
  });

  it("Readiness.classify on shell fixture → shell", async () => {
    const shell = JSON.parse(readFileSync(join(FIXTURES, "ax/react-shell.json"), "utf8")) as { nodes: AxNode[] };
    const wire = new ScriptedCdp();
    wire.handlers.set("Accessibility.getFullAXTree", () => ({ nodes: shell.nodes }));
    const ready = new CdpReadiness(wire, () => ({ tabId: "t", frameId: "main", origin: "https://app.test" }));
    const stats = await ready.classify();
    expect(stats.shape).toBe("shell");
  });

  it("spawn args include --remote-debugging-address=127.0.0.1", () => {
    const args = chromeLaunchArgs({
      browser: "chrome",
      userDataDir: "/tmp/tyto-profile",
      port: 9222,
      bindHost: "127.0.0.1",
    });
    expect(args.some((a) => a === "--remote-debugging-address=127.0.0.1")).toBe(true);
    expect(args.join(" ")).not.toMatch(/0\.0\.0\.0/);
  });

  it("ProfileCatalog reads Local State fixture names without launching", async () => {
    const catalog = new LocalStateProfileCatalog(join(FIXTURES, "local-state"));
    const profiles = await catalog.list("chrome");
    expect(profiles.map((p) => p.name).sort()).toEqual(["Person 1", "Work"]);
    expect(profiles.every((p) => p.browser === "chrome")).toBe(true);
    expect(profiles.some((p) => p.directory.endsWith("Default"))).toBe(true);
  });

  it("adapter source does not import playwright", () => {
    for (const name of readdirSync(SRC)) {
      if (!name.endsWith(".ts")) continue;
      const text = readFileSync(join(SRC, name), "utf8");
      expect(text, name).not.toMatch(/playwright/i);
    }
  });
});
