import { describe, expect, it } from "vitest";
import { compactAx } from "../src/ax/compact.ts";
import { extractOrThrow, ShellNotReady } from "../src/ax/extract.ts";
import { DefaultConfirmGate } from "../src/policy/confirm.ts";
import { OriginAllowlist } from "../src/policy/allow.ts";
import { RUNNER_EXIT, unattendedExit } from "../src/runner/exit.ts";
import type { Operator } from "../src/ports/operator.ts";

describe("unattended runner", () => {
  const gate = new DefaultConfirmGate();
  const operator: Operator = {
    confirm: async () => {
      throw new Error("HITL must not run in unattended runner");
    },
    pasteGoal() {},
  };

  it("exit 0 on done", () => {
    expect(unattendedExit({ kind: "done" }, { allowConfirmFail: false }, gate, operator)).toBe(0);
    expect(unattendedExit({ kind: "done" }, { allowConfirmFail: false }, gate, operator)).toBe(RUNNER_EXIT.done);
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
      expect(unattendedExit({ kind: "error", error: e }, { allowConfirmFail: false }, gate, operator)).toBe(2);
    }
  });

  it("exit 3 on allowlist deny", () => {
    const allow = new OriginAllowlist();
    expect(allow.permits(new URL("https://evil.test/"))).toBe(false);
    expect(unattendedExit({ kind: "deny" }, { allowConfirmFail: false }, gate, operator)).toBe(3);
  });

  it("exit 4 on confirm required and --no-confirm", () => {
    expect(
      unattendedExit(
        { kind: "confirm", intent: { kind: "submit" } },
        { allowConfirmFail: false },
        gate,
        operator,
      ),
    ).toBe(4);
  });

  it("no HITL in runner unless --allow-confirm-fail", () => {
    expect(
      unattendedExit(
        { kind: "confirm", intent: { kind: "purchase" } },
        { allowConfirmFail: true },
        gate,
        operator,
      ),
    ).toBe(0);
  });
});
