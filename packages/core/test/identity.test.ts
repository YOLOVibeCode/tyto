import { describe, expect, it } from "vitest";
import { DefaultAuthProfiler } from "../src/auth/classify.ts";
import { bundleStatus } from "../src/auth/expiry.ts";
import { SecretRedactor } from "../src/identity/redact.ts";
import { FakeClock } from "../src/testing/fakes.ts";

describe("identity vault domain", () => {
  const profiler = new DefaultAuthProfiler();

  it("AuthProfiler.identify: Set-Cookie evidence → cookieSession", () => {
    expect(profiler.identify({ setCookie: true }).method).toBe("cookieSession");
  });

  it("AuthProfiler.identify: Authorization Bearer header → oauthBearer", () => {
    expect(profiler.identify({ authorizationBearer: true }).method).toBe("oauthBearer");
  });

  it("AuthProfiler.identify: SAMLResponse form POST → samlSso", () => {
    expect(profiler.identify({ samlResponsePost: true, idpOrigin: "https://idp.example.edu" })).toMatchObject({
      method: "samlSso",
      idpOrigin: "https://idp.example.edu",
    });
  });

  it("AuthProfiler.identify: Negotiate challenge → negotiateIWA", () => {
    expect(profiler.identify({ wwwAuthenticateNegotiate: true }).method).toBe("negotiateIWA");
  });

  it("AuthProfiler.identify: no auth signals → unknown", () => {
    expect(profiler.identify({}).method).toBe("unknown");
  });

  it("auth/expiry: bundle within TTL → fresh", () => {
    const clock = new FakeClock();
    clock.t = 1_000;
    expect(bundleStatus({ capturedAt: 0, expiryHint: 1_000 + 20 * 60 * 1000 }, clock)).toBe("fresh");
  });

  it("auth/expiry: bundle past expiry hint → expired", () => {
    const clock = new FakeClock();
    clock.t = 50_000;
    expect(bundleStatus({ capturedAt: 0, expiryHint: 10_000 }, clock)).toBe("expired");
  });

  it("auth/expiry: bundle within 10m of expiry → expiring", () => {
    const clock = new FakeClock();
    clock.t = 1_000;
    expect(bundleStatus({ capturedAt: 0, expiryHint: 1_000 + 5 * 60 * 1000 }, clock)).toBe("expiring");
  });

  it("Redactor.tape: strips Set-Cookie header from tape event", () => {
    const r = new SecretRedactor();
    const e = r.tape({ t: 0, kind: "network", detail: "Set-Cookie: sessionid=abc123xyz999; Path=/" });
    expect(e.detail).toContain("[REDACTED]");
    expect(e.detail).not.toContain("abc123xyz999");
  });

  it("Redactor.tape: strips Authorization Bearer from tape event", () => {
    const r = new SecretRedactor();
    const e = r.tape({ t: 0, kind: "network", detail: "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.aaa" });
    expect(e.detail).toContain("[REDACTED]");
    expect(e.detail).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("Redactor.prompt: CompleteRequest after redaction contains no cookie-shaped string", () => {
    const r = new SecretRedactor();
    const out = r.prompt({
      system: "plan",
      user: "Cookie: sessionid=supersecretvalue99",
    });
    expect(out.user).not.toContain("supersecretvalue99");
  });

  it("Redactor.safe: auth-material-shaped string → redacted; plain text unchanged", () => {
    const r = new SecretRedactor();
    expect(r.safe("hello barn owl")).toBe("hello barn owl");
    expect(r.safe("Bearer aaaaa.bbbbb.ccccc")).toContain("[REDACTED]");
  });
});
