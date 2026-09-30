import { describe, expect, it } from "vitest";
import { SecretRedactor } from "../src/identity/redact.ts";

describe("SecretRedactor", () => {
  const r = new SecretRedactor();

  it("masks Cookie and Set-Cookie header values", () => {
    expect(r.safe("Set-Cookie: sid=abc123def456; Path=/")).not.toContain("abc123def456");
    expect(r.safe("cookie: session=zzz999yyy888")).not.toContain("zzz999yyy888");
  });

  it("masks bearer tokens", () => {
    expect(r.safe("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig")).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("masks sk- style API keys", () => {
    expect(r.safe("key sk-ant-abcdefghijklmnop1234")).not.toContain("abcdefghijklmnop1234");
  });

  it("masks token, password, api_key and sid values in JSON and query strings", () => {
    const out = r.safe('{"token":"t0k3nVALUE","password":"hunter2hunter2"} ?api_key=KEY123456&sid=S3SS10N99');
    for (const secret of ["t0k3nVALUE", "hunter2hunter2", "KEY123456", "S3SS10N99"]) expect(out).not.toContain(secret);
    expect(out).toContain('"token"');
  });

  it("leaves ordinary text unchanged", () => {
    const text = "Western barn owl — Least Concern (IUCN 3.1)";
    expect(r.safe(text)).toBe(text);
  });

  it("prompt redacts system, user, and page text", () => {
    const out = r.prompt({ system: "Bearer abcdefghijklmnop", user: "token=secretvalue1", page: { kind: "untrusted", text: "Cookie: a=bbbbbbbbbbbb" } });
    expect(JSON.stringify(out)).not.toMatch(/abcdefghijklmnop|secretvalue1|bbbbbbbbbbbb/);
    expect(out.page?.kind).toBe("untrusted");
  });
});
