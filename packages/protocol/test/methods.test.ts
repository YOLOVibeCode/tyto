import { describe, expect, it } from "vitest";
import { isPerchSafeMethod, methodAllowed, PERCH_SAFE_METHODS, POWER_METHODS, RPC_ERROR } from "../src/index.ts";

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

  it("POWER_METHODS is disjoint from PERCH_SAFE_METHODS", () => {
    expect(POWER_METHODS.length).toBeGreaterThan(0);
    for (const m of POWER_METHODS) expect(isPerchSafeMethod(m)).toBe(false);
    expect(POWER_METHODS).toContain("cdp.send");
    expect(POWER_METHODS).toContain("cookies.list");
  });

  it("safe scope allows only Perch-safe methods; power scope allows both", () => {
    expect(methodAllowed("safe", "session.list")).toBe(true);
    expect(methodAllowed("safe", "cdp.send")).toBe(false);
    expect(methodAllowed("power", "session.list")).toBe(true);
    expect(methodAllowed("power", "cdp.send")).toBe(true);
    expect(methodAllowed("power", "debug.nope")).toBe(false);
  });

  it("unauthorized and policy use stable JSON-RPC error codes, not stack traces", () => {
    expect(RPC_ERROR.UNAUTHORIZED).toBe(-32001);
    expect(RPC_ERROR.POLICY).toBe(-32003);
    expect(RPC_ERROR.METHOD_NOT_FOUND).toBe(-32601);
  });
});
