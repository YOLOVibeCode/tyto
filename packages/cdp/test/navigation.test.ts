import { describe, expect, it } from "vitest";
import { CdpNavigation } from "../src/navigation.ts";
import { ScriptedCdp } from "./scripted-cdp.ts";

describe("CDP Navigation", () => {
  it("goto sends Page.navigate on the page session, not Runtime.evaluate", async () => {
    const wire = new ScriptedCdp();
    wire.handlers.set("Page.enable", () => ({}));
    wire.handlers.set("Page.navigate", () => ({ frameId: "f1" }));
    const nav = new CdpNavigation(wire, () => "sid-page");
    await nav.goto(new URL("https://example.com/"));
    expect(wire.calls.map((c) => c.method)).toEqual(["Page.enable", "Page.navigate"]);
    expect(wire.calls[1]?.sessionId).toBe("sid-page");
    expect(wire.calls[1]?.params).toEqual({ url: "https://example.com/" });
    expect(JSON.stringify(wire.calls)).not.toMatch(/Runtime\.evaluate/);
    await expect(nav.currentUrl()).resolves.toEqual(new URL("https://example.com/"));
  });
});
