import { describe, expect, it } from "vitest";
import { openSteerTab } from "../src/steer-tab.ts";
import { ScriptedCdp } from "./scripted-cdp.ts";

describe("openSteerTab", () => {
  it("Target.createTarget on the loopback host URL, never Runtime.evaluate", async () => {
    const wire = new ScriptedCdp();
    wire.handlers.set("Target.createTarget", (params) => {
      expect(params).toMatchObject({ url: "http://127.0.0.1:7420/" });
      return { targetId: "steer-1" };
    });
    const result = await openSteerTab(wire, new URL("http://127.0.0.1:7420/"));
    expect(result.targetId).toBe("steer-1");
    expect(wire.calls.map((c) => c.method)).toEqual(["Target.createTarget"]);
    expect(wire.calls[0]?.sessionId).toBeUndefined();
    expect(wire.calls.map((c) => c.method)).not.toContain("Target.attachToTarget");
    expect(wire.calls.map((c) => c.method)).not.toContain("Runtime.evaluate");
  });

  it("refuses a non-loopback URL", async () => {
    const wire = new ScriptedCdp();
    await expect(openSteerTab(wire, new URL("https://evil.test/"))).rejects.toThrow(/bind refused/i);
    expect(wire.calls).toEqual([]);
  });
});
