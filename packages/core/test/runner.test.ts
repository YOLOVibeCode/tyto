import { describe, expect, it } from "vitest";
import { compactAx } from "../src/ax/compact.ts";
import { extractOrThrow, ShellNotReady } from "../src/ax/extract.ts";
import { DefaultConfirmGate } from "../src/policy/confirm.ts";
import { OriginAllowlist } from "../src/policy/allow.ts";
import { SecretRedactor } from "../src/identity/redact.ts";
import { RUNNER_EXIT, unattendedExit } from "../src/runner/exit.ts";
import { runUnattended, parseRunnerArgs, type UnattendedDeps } from "../src/runner/run.ts";
import { emptySession } from "../src/session/schema.ts";
import { makeLoopHarness, type LoopHarness } from "../src/testing/harness.ts";
import type { Operator } from "../src/ports/operator.ts";

const silentOperator: Operator = {
  confirm: async () => {
    throw new Error("HITL must not run in unattended runner");
  },
  pasteGoal() {},
};

function runnerDeps(h: LoopHarness): UnattendedDeps {
  return {
    store: h.store,
    occupancy: h.occupancy,
    actuation: h.actuation,
    model: h.model,
    redactor: new SecretRedactor(),
    allowlist: h.allowlist,
    navigation: h.navigation,
    perception: h.perception,
    confirm: new DefaultConfirmGate(),
  };
}

describe("unattended runner", () => {
  const gate = new DefaultConfirmGate();

  it("exit 0 on done", () => {
    expect(unattendedExit({ kind: "done" }, { allowConfirmFail: false }, gate, silentOperator)).toBe(0);
    expect(unattendedExit({ kind: "done" }, { allowConfirmFail: false }, gate, silentOperator)).toBe(RUNNER_EXIT.done);
  });

  it("exit 2 on ShellNotReady", () => {
    const snap = compactAx(
      [{ nodeId: "1", role: { value: "WebArea" }, name: { value: "App" } }],
      { generation: 1, origin: "https://app.test", url: "https://app.test/", title: "x" },
    );
    expect(() => extractOrThrow("shell", snap, "status")).toThrow(ShellNotReady);
    try {
      extractOrThrow("shell", snap, "status");
    } catch (e) {
      expect(unattendedExit({ kind: "error", error: e }, { allowConfirmFail: false }, gate, silentOperator)).toBe(2);
    }
  });

  it("exit 3 on allowlist deny", () => {
    const allow = new OriginAllowlist();
    expect(allow.permits(new URL("https://evil.test/"))).toBe(false);
    expect(unattendedExit({ kind: "deny" }, { allowConfirmFail: false }, gate, silentOperator)).toBe(3);
  });

  it("exit 4 on confirm required and --no-confirm", () => {
    expect(
      unattendedExit(
        { kind: "confirm", intent: { kind: "submit" } },
        { allowConfirmFail: false },
        gate,
        silentOperator,
      ),
    ).toBe(4);
  });

  it("no HITL in runner unless --allow-confirm-fail", () => {
    expect(
      unattendedExit(
        { kind: "confirm", intent: { kind: "purchase" } },
        { allowConfirmFail: true },
        gate,
        silentOperator,
      ),
    ).toBe(0);
  });

  it("parseRunnerArgs: --session and --allow-confirm-fail", () => {
    expect(parseRunnerArgs(["--session", "abc", "--allow-confirm-fail"])).toEqual({
      sessionId: "abc",
      allowConfirmFail: true,
    });
    expect(parseRunnerArgs(["--no-confirm", "xyz"]).sessionId).toBe("xyz");
    expect(parseRunnerArgs(["--no-confirm", "xyz"]).allowConfirmFail).toBe(false);
  });

  it("runUnattended: exit 0 on done", async () => {
    const h = makeLoopHarness();
    const session = emptySession("r0", "done already");
    session.remainingSteps = [{ op: "done", reason: "ok" }];
    const code = await runUnattended(session, h.frame, { allowConfirmFail: false }, runnerDeps(h), silentOperator);
    expect(code).toBe(0);
  });

  it("runUnattended: exit 2 on ShellNotReady", async () => {
    const h = makeLoopHarness();
    h.perception.currentUrl = "https://app.test/";
    h.perception.seedUrl(
      "https://app.test/",
      [{ nodeId: "1", role: { value: "WebArea" }, name: { value: "loading..." } }],
      "App",
    );
    const session = emptySession("r2", "extract status");
    session.lastUrl = "https://app.test/";
    session.allowlist = ["https://app.test"];
    session.remainingSteps = [{ op: "extract", query: "status" }];
    h.allowlist.grant("https://app.test");
    const code = await runUnattended(session, h.frame, { allowConfirmFail: false }, runnerDeps(h), silentOperator);
    expect(code).toBe(2);
  });

  it("runUnattended: exit 3 on allowlist deny", async () => {
    const h = makeLoopHarness();
    const session = emptySession("r3", "evil");
    session.lastUrl = "https://evil.test/";
    const code = await runUnattended(session, h.frame, { allowConfirmFail: false }, runnerDeps(h), silentOperator);
    expect(code).toBe(3);
  });

  it("runUnattended: exit 4 on confirm required and --no-confirm", async () => {
    const h = makeLoopHarness();
    const session = emptySession("r4", "buy");
    session.remainingSteps = [{ op: "click", role: "button", name: "purchase" }];
    const code = await runUnattended(session, h.frame, { allowConfirmFail: false }, runnerDeps(h), silentOperator);
    expect(code).toBe(4);
    expect(h.actuation.performed).toHaveLength(0);
  });

  it("runUnattended: --allow-confirm-fail performs without HITL", async () => {
    const h = makeLoopHarness();
    h.perception.currentUrl = "https://shop.test/";
    h.perception.seedUrl(
      "https://shop.test/",
      [
        { nodeId: "1", childIds: ["2"], role: { value: "WebArea" }, name: { value: "Shop" } },
        {
          nodeId: "2",
          parentId: "1",
          role: { value: "button" },
          name: { value: "purchase" },
          backendDOMNodeId: 9,
        },
      ],
      "Shop",
    );
    const session = emptySession("r4b", "buy");
    session.lastUrl = "https://shop.test/";
    session.allowlist = ["https://shop.test"];
    session.remainingSteps = [{ op: "click", role: "button", name: "purchase" }];
    h.allowlist.grant("https://shop.test");
    const code = await runUnattended(session, h.frame, { allowConfirmFail: true }, runnerDeps(h), silentOperator);
    expect(code).toBe(0);
    expect(h.actuation.performed).toHaveLength(1);
  });
});
