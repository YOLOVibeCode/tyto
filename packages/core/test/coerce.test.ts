import { describe, expect, it } from "vitest";
import { coercePlan } from "../src/plan/coerce.ts";

describe("plan coerce", () => {
  it("schema-shaped plan parses", () => {
    const p = coercePlan({
      rationale: "search",
      anchors: [{ id: "a", role: "searchbox", name: "Search" }],
      steps: [{ op: "fill", role: "searchbox", name: "Search", text: "barn owl" }],
    });
    expect(p?.steps[0]?.op).toBe("fill");
  });

  it("alternate JSON { action, label } coerces to click", () => {
    const p = coercePlan({ steps: [{ action: "click", label: "Barn owl", role: "link" }] });
    expect(p?.steps[0]).toMatchObject({ op: "click", name: "Barn owl" });
  });

  it("unknown op discarded; empty steps is a failed plan not a throw", () => {
    expect(coercePlan({ steps: [{ op: "teleport" }] })).toBeNull();
  });

  it("model returning prose with a fenced JSON block still coerces", () => {
    const p = coercePlan('Sure.\n```json\n{"steps":[{"op":"done","reason":"ok"}]}\n```');
    expect(p?.steps[0]?.op).toBe("done");
  });
});
