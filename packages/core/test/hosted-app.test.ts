import { describe, expect, it } from "vitest";
import { pickWorkingDocument } from "../src/frame/pick.ts";
import { applyPageMessage } from "../src/policy/page-command.ts";
import { OriginAllowlist } from "../src/policy/allow.ts";
import { emptySession } from "../src/session/schema.ts";
import { makeLoopHarness } from "../src/testing/harness.ts";
import { waitForTape } from "../src/loop/wait.ts";
import type { AxNode, FrameRef, FrameSnap } from "../src/types.ts";

const PARENT_ORIGIN = "https://hr.example.edu";
const TENANT_ORIGIN = "https://wd5.myworkday.com";
const OTHER_PORTAL = "https://okta-portal.example.edu";

const PARENT: FrameSnap = {
  ref: { tabId: "t", frameId: "p", origin: PARENT_ORIGIN },
  origin: PARENT_ORIGIN,
  attached: true,
  shape: "shell",
  axNodes: 12,
  tree: "banner Jump to content",
  hasRecipes: false,
  landmarks: [],
};

const CHILD: FrameSnap = {
  ref: { tabId: "t", frameId: "c", origin: TENANT_ORIGIN },
  origin: TENANT_ORIGIN,
  attached: true,
  shape: "injected",
  axNodes: 400,
  tree: "main Search Worker",
  hasRecipes: true,
  landmarks: ["main"],
};

const PARENT_CHROME: AxNode[] = [
  { nodeId: "1", childIds: ["2"], role: { value: "WebArea" }, name: { value: "HR portal" } },
  { nodeId: "2", parentId: "1", role: { value: "link" }, name: { value: "Jump to content" }, backendDOMNodeId: 2 },
];

const TENANT_APP: AxNode[] = [
  { nodeId: "1", childIds: ["2", "3"], role: { value: "WebArea" }, name: { value: "Workday" } },
  {
    nodeId: "2",
    parentId: "1",
    role: { value: "button" },
    name: { value: "Search Worker" },
    backendDOMNodeId: 77,
  },
  { nodeId: "3", parentId: "1", role: { value: "heading" }, name: { value: "main" } },
];

const LIST_SHORT: AxNode[] = [
  { nodeId: "1", childIds: ["2"], role: { value: "WebArea" }, name: { value: "Directory" } },
  { nodeId: "2", parentId: "1", role: { value: "link" }, name: { value: "Ada Lovelace" }, backendDOMNodeId: 10 },
];

const LIST_GROWN: AxNode[] = [
  { nodeId: "1", childIds: ["2", "3"], role: { value: "WebArea" }, name: { value: "Directory" } },
  { nodeId: "2", parentId: "1", role: { value: "link" }, name: { value: "Ada Lovelace" }, backendDOMNodeId: 10 },
  { nodeId: "3", parentId: "1", role: { value: "link" }, name: { value: "row 50" }, backendDOMNodeId: 50 },
];

describe("Slice 6b hosted app / frame graph", () => {
  it("list frames: parent example.edu + child myworkday.com; child starts unattached → reasonEmpty, parent snapshot is chrome-only", async () => {
    const h = makeLoopHarness();
    h.frames.nodes = [
      { ref: PARENT.ref, origin: PARENT_ORIGIN, attached: true },
      { ref: CHILD.ref, origin: TENANT_ORIGIN, attached: false, reasonEmpty: "oopif" },
    ];
    const listed = await h.frames.list("t");
    expect(listed.map((f) => f.origin)).toEqual([PARENT_ORIGIN, TENANT_ORIGIN]);
    expect(listed[1]?.attached).toBe(false);
    expect(listed[1]?.reasonEmpty).toBe("oopif");
    h.perception.seedFrame("p", PARENT_CHROME, "HR portal", PARENT_ORIGIN);
    const parentSnap = await h.perception.snapshot(PARENT.ref);
    expect(parentSnap.tree).toMatch(/Jump to content/);
    expect(parentSnap.tree).not.toMatch(/Search Worker/);
    expect(pickWorkingDocument([{ ...CHILD, attached: false, reasonEmpty: "oopif" }, PARENT])?.frameId).toBe("p");
  });

  it("autoAttach then child snapshot is the app tree; compact tree labeled # frame https://wd5.myworkday.com", async () => {
    const h = makeLoopHarness();
    await h.frames.autoAttachChildTargets(true);
    expect(h.frames.autoAttach).toBe(true);
    h.perception.seedFrame("c", TENANT_APP, "Workday", TENANT_ORIGIN);
    const snap = await h.perception.snapshot(CHILD.ref);
    expect(snap.tree).toContain(`# frame ${TENANT_ORIGIN}`);
    expect(snap.tree).toContain("Search Worker");
  });

  it("pickWorkingDocument returns none if tenant origin not allowlisted", () => {
    const allow = new OriginAllowlist();
    expect(pickWorkingDocument([PARENT, CHILD], allow)).toBeNull();
  });

  it("operator grants tenant origin; next pick succeeds; grant is session-scoped", () => {
    const sessionAllow = new OriginAllowlist();
    sessionAllow.grant(TENANT_ORIGIN);
    expect(pickWorkingDocument([PARENT, CHILD], sessionAllow)?.frameId).toBe("c");
    const otherSession = new OriginAllowlist();
    expect(pickWorkingDocument([PARENT, CHILD], otherSession)).toBeNull();
  });

  it("recipe archive keys by child origin; replay works when parent URL is a different portal", async () => {
    const h = makeLoopHarness();
    h.perception.seedFrame("c", TENANT_APP, "Workday", TENANT_ORIGIN);
    const childSnap = await h.perception.snapshot(CHILD.ref);
    for (const r of childSnap.recipes) h.archive.remember(TENANT_ORIGIN, r);
    expect(h.archive.lookup(PARENT_ORIGIN, "button", "Search Worker")).toBeNull();
    expect(h.archive.lookup(TENANT_ORIGIN, "button", "Search Worker")).toBeTruthy();

    h.perception.currentUrl = `${OTHER_PORTAL}/app`;
    const session = emptySession("wd", "find worker");
    session.remainingSteps = [{ op: "click", role: "button", name: "Search Worker" }];
    await h.loop.play(session, childSnap, CHILD.ref);
    expect(h.model.calls).toBe(0);
    expect(h.actuation.performed[0]?.frame.frameId).toBe("c");
    expect(h.actuation.performed[0]?.frame.origin).toBe(TENANT_ORIGIN);
  });

  it("waitReady is per-frame: parent static chrome does not satisfy child shell", async () => {
    const h = makeLoopHarness();
    h.readiness.set(PARENT.ref, "static");
    h.readiness.set(CHILD.ref, "shell");
    h.readiness.target = PARENT.ref;
    await h.readiness.waitReady(5_000);
    expect((await h.readiness.classify()).shape).toBe("static");
    h.readiness.target = CHILD.ref;
    expect((await h.readiness.classify()).shape).toBe("shell");
  });

  it("SPA view change with no top-level nav: tape frame event + AX growth; WAIT succeeds without Page.navigate", async () => {
    const h = makeLoopHarness();
    h.perception.seedFrame("c", TENANT_APP, "Workday", TENANT_ORIGIN);
    const waiting = waitForTape(h.observation, (e) => e.kind === "spa" || e.kind === "frame", 5_000, h.clock);
    h.observation.push("spa", "view:directory");
    await expect(waiting).resolves.toBe("ok");
    expect(h.navigation.gotoCalls).toBe(0);
  });

  it("virtualized list: scroll intent on focused frame → new rows in next snapshot", async () => {
    const h = makeLoopHarness();
    const frame: FrameRef = CHILD.ref;
    h.perception.seedFrame("c", LIST_SHORT, "Directory", TENANT_ORIGIN);
    h.frames.focus(frame);
    const before = await h.perception.snapshot(frame);
    expect(before.tree).not.toContain("row 50");
    await h.actuation.perform({ op: "scroll", node: 10, frame });
    h.perception.seedFrame("c", LIST_GROWN, "Directory", TENANT_ORIGIN);
    const after = await h.perception.snapshot(frame);
    expect(after.tree).toContain("row 50");
    expect(h.actuation.performed[0]?.frame.frameId).toBe("c");
  });

  it("SSO popup appears as RelatedTargets page; Occupancy yield until operator marks login done; then Workday frame leaves shell", async () => {
    const h = makeLoopHarness();
    h.related.tabs = [{ id: "sso", url: "https://idp.example.edu/login" }];
    expect(await h.related.pages()).toEqual([{ id: "sso", url: "https://idp.example.edu/login" }]);
    h.occupancy.noteInput();
    expect(h.occupancy.operatorActive()).toBe(true);
    h.readiness.set(CHILD.ref, "shell");
    h.readiness.target = CHILD.ref;
    expect((await h.readiness.classify()).shape).toBe("shell");

    h.occupancy.active = false;
    h.related.tabs = [];
    h.readiness.set(CHILD.ref, "injected");
    expect(h.occupancy.operatorActive()).toBe(false);
    expect(await h.related.pages()).toEqual([]);
    expect((await h.readiness.classify()).shape).toBe("injected");
  });

  it("page postMessage from parent cannot focus or grant the child", () => {
    const h = makeLoopHarness();
    expect(
      applyPageMessage(
        { type: "fromPage", focus: CHILD.ref, grant: TENANT_ORIGIN },
        { allowlist: h.allowlist, frames: h.frames },
      ),
    ).toBe(false);
    expect(h.allowlist.permits(new URL(`${TENANT_ORIGIN}/`))).toBe(false);
    expect(h.frames.focused).toBeUndefined();
  });
});
