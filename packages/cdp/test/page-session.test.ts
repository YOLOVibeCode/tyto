import { describe, expect, it } from "vitest";
import { attachPageSession } from "../src/page-session.ts";
import { ScriptedCdp } from "./scripted-cdp.ts";

describe("CDP page session", () => {
  it("Target.setAutoAttach flatten then attachToTarget returns page sessionId", async () => {
    const wire = new ScriptedCdp();
    wire.handlers.set("Target.setAutoAttach", () => ({}));
    wire.handlers.set("Target.getTargets", () => ({
      targetInfos: [{ targetId: "page-1", type: "page", url: "about:blank" }],
    }));
    wire.handlers.set("Target.attachToTarget", (params) => {
      expect(params).toMatchObject({ targetId: "page-1", flatten: true });
      return { sessionId: "sid-page" };
    });
    const sid = await attachPageSession(wire);
    expect(sid).toBe("sid-page");
    const auto = wire.calls.find((c) => c.method === "Target.setAutoAttach");
    expect(auto?.params).toMatchObject({ autoAttach: true, flatten: true, waitForDebuggerOnStart: false });
    expect(wire.calls.find((c) => c.method === "Accessibility.enable")?.sessionId).toBe("sid-page");
    expect(wire.calls.find((c) => c.method === "Page.enable")?.sessionId).toBe("sid-page");
  });

  it("creates about:blank when no page target exists", async () => {
    const wire = new ScriptedCdp();
    wire.handlers.set("Target.setAutoAttach", () => ({}));
    wire.handlers.set("Target.getTargets", () => ({ targetInfos: [] }));
    wire.handlers.set("Target.createTarget", (params) => {
      expect(params).toMatchObject({ url: "about:blank" });
      return { targetId: "new-page" };
    });
    wire.handlers.set("Target.attachToTarget", () => ({ sessionId: "sid-new" }));
    await expect(attachPageSession(wire)).resolves.toBe("sid-new");
  });
});
