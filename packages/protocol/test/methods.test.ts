import { describe, expect, it } from "vitest";
import { PERCH_SAFE_METHODS } from "../src/index.ts";

describe("protocol", () => {
  it("MCP tool list equals Perch-safe methods (no debug.cdp, no CredentialStore)", () => {
    expect(PERCH_SAFE_METHODS).not.toContain("debug.cdp");
    expect(PERCH_SAFE_METHODS.join(" ")).not.toMatch(/cdp\.send|credential/i);
    expect(PERCH_SAFE_METHODS).toContain("identity.status");
    expect(PERCH_SAFE_METHODS).not.toContain("identity.capture");
  });
});
