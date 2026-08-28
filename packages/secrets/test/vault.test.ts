import { describe, expect, it } from "vitest";
import { OriginAllowlist } from "@tyto/core";
import { FakeCredentialStore } from "@tyto/core/testing";
import { MemoryIdentityVault, MemorySecretStore } from "../src/index.ts";

describe("MemoryIdentityVault", () => {
  it("capture then restore round-trips; ciphertext is not plaintext cookies", async () => {
    const origin = "https://ex.test";
    const cookies = [
      {
        name: "sessionid",
        value: "supersecretcookievalue",
        domain: "ex.test",
        path: "/",
        httpOnly: true,
        secure: true,
      },
    ];
    const creds = new FakeCredentialStore();
    creds.seed(origin, cookies, { localStorage: {}, sessionStorage: {}, indexedDb: {} });
    const allow = new OriginAllowlist();
    allow.grant(origin);
    const vault = new MemoryIdentityVault(new MemorySecretStore(), allow, creds);
    const handle = await vault.capture(origin);
    expect(handle.startsWith("vault_")).toBe(true);
    expect(vault.ciphertext(origin)).toBeTruthy();
    expect(vault.ciphertext(origin)).not.toContain("supersecretcookievalue");
    creds.cookies.delete(origin);
    await vault.restore(origin);
    expect(creds.cookies.get(origin)?.[0]?.value).toBe("supersecretcookievalue");
  });

  it("bindCredentialStore: restore writes into the newly bound store", async () => {
    const origin = "https://ex.test";
    const cookies = [
      {
        name: "sessionid",
        value: "supersecretcookievalue",
        domain: "ex.test",
        path: "/",
        httpOnly: true,
        secure: true,
      },
    ];
    const empty = { localStorage: {}, sessionStorage: {}, indexedDb: {} };
    const first = new FakeCredentialStore();
    first.seed(origin, cookies, empty);
    const allow = new OriginAllowlist();
    allow.grant(origin);
    const vault = new MemoryIdentityVault(new MemorySecretStore(), allow, first);
    await vault.capture(origin);
    const second = new FakeCredentialStore();
    vault.bindCredentialStore(second);
    await vault.restore(origin);
    expect(second.cookies.get(origin)?.[0]?.value).toBe("supersecretcookievalue");
    expect(first.writeCookieCalls).toHaveLength(0);
  });

  it("capture on a not-granted origin is refused", async () => {
    const vault = new MemoryIdentityVault(
      new MemorySecretStore(),
      new OriginAllowlist(),
      new FakeCredentialStore(),
    );
    await expect(vault.capture("https://evil.test")).rejects.toThrow(/grant denied/);
  });
});
