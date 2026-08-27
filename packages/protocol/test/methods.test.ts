import { describe, expect, it } from "vitest";
import { isPerchSafeMethod, PERCH_SAFE_METHODS, RPC_ERROR } from "../src/index.ts";

describe("protocol", () => {
  it("MCP tool list equals Perch-safe methods (no debug.cdp, no CredentialStore)", () => {
    expect(PERCH_SAFE_METHODS).not.toContain("debug.cdp");
    expect(PERCH_SAFE_METHODS.join(" ")).not.toMatch(/cdp\.send|credential/i);
    expect(PERCH_SAFE_METHODS).toContain("identity.status");
    expect(PERCH_SAFE_METHODS).toContain("session.run");
    expect(PERCH_SAFE_METHODS).not.toContain("identity.capture");
    expect(isPerchSafeMethod("session.open")).toBe(true);
    expect(isPerchSafeMethod("debug.cdp")).toBe(false);
    expect(isPerchSafeMethod("identity.capture")).toBe(false);
  });

  it("unauthorized and policy use stable JSON-RPC error codes, not stack traces", () => {
    expect(RPC_ERROR.UNAUTHORIZED).toBe(-32001);
    expect(RPC_ERROR.POLICY).toBe(-32003);
    expect(RPC_ERROR.METHOD_NOT_FOUND).toBe(-32601);
  });
});
