import { describe, expect, it } from "vitest";
import { FakeBrowserRunner } from "@tyto/core/testing";
import { TYTO_SESSIONS, closeTytoSession } from "../src/sessions.ts";

describe("Tyto's agent-browser sessions", () => {
  it("include the batch lanes tyto-rx-1 … tyto-rx-8, so doctor lists and closes them", () => {
    expect(TYTO_SESSIONS).toEqual(["tyto-rx", "tyto-rx-auth", "tyto-compile", ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `tyto-rx-${n}`)]);
  });

  it("closing one uses Tyto's agent-browser config, never yours, so close cannot save into your restore state", async () => {
    const runner = new FakeBrowserRunner();
    await closeTytoSession(runner, "/home/alex/.tyto/agent-browser.json")("tyto-rx-2");
    expect(runner.runs).toEqual([{ argv: ["close"], opts: { session: "tyto-rx-2", env: { AGENT_BROWSER_CONFIG: "/home/alex/.tyto/agent-browser.json" } } }]);
  });
});
