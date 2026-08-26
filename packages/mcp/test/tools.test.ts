import { describe, expect, it } from "vitest";
import { PERCH_SAFE_METHODS } from "@tyto/protocol";
import { toolNames } from "../src/index.ts";

describe("mcp tools", () => {
  it("MCP tool list equals Perch-safe methods (no debug.cdp)", () => {
    expect([...toolNames()]).toEqual([...PERCH_SAFE_METHODS]);
    expect(toolNames()).not.toContain("debug.cdp");
  });
});
