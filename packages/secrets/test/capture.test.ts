import { describe, expect, it } from "vitest";
import { OriginAllowlist } from "@tyto/core";
import { FakeClock, FakeCredentialStore, FakeOccupancy } from "@tyto/core/testing";
import { DefaultConfirmGate } from "@tyto/core";
import { MemoryIdentityVault, MemorySecretStore } from "../src/index.ts";

const ORIGIN = "https://hr.example.edu";
const IDP = "https://idp.example.edu";
const COOKIE_VAL = "supersecretcookievalue";

function cookie() {
  return {
    name: "sessionid",
    value: COOKIE_VAL,
    domain: "hr.example.edu",
    path: "/",
    httpOnly: true,
    secure: true,
  };
}

function storage() {
  return { localStorage: { k: "v" }, sessionStorage: {}, indexedDb: {} };
}

function vault(
  creds: FakeCredentialStore,
  allow = new OriginAllowlist(),
  extras: ConstructorParameters<typeof MemoryIdentityVault>[3] = {},
) {
  allow.grant(ORIGIN);
  return new MemoryIdentityVault(new MemorySecretStore(), allow, creds, extras);
}

describe("identity vault (Slice 9b fakes)", () => {
  it("capture: CredentialStorePort.readCookies + readStorage called; ciphertext written; plaintext never on disk", async () => {
    const creds = new FakeCredentialStore();
    creds.seed(ORIGIN, [cookie()], storage());
    const v = vault(creds);
    const handle = await v.capture(ORIGIN);
    expect(handle.startsWith("vault_")).toBe(true);
    expect(creds.readCookieCalls).toBe(1);
    expect(creds.readStorageCalls).toBe(1);
    expect(v.ciphertext(ORIGIN)).toBeTruthy();
    expect(v.ciphertext(ORIGIN)).not.toContain(COOKIE_VAL);
    expect(JSON.stringify(v.bundleRecord(ORIGIN))).not.toContain(COOKIE_VAL);
  });

  it("capture: DEK stored via SecretStore (fake keychain); not in the bundle file", async () => {
    const creds = new FakeCredentialStore();
    creds.seed(ORIGIN, [cookie()], storage());
    const secrets = new MemorySecretStore();
    const allow = new OriginAllowlist();
    allow.grant(ORIGIN);
    const v = new MemoryIdentityVault(secrets, allow, creds);
    await v.capture(ORIGIN);
    const dekRef = v.dekRef(ORIGIN);
    expect(dekRef).toBeTruthy();
    expect(secrets.getDek(dekRef!)).toBeTruthy();
    expect(JSON.stringify(v.bundleRecord(ORIGIN))).not.toContain(secrets.getDek(dekRef!).toString("hex"));
  });

  it("capture: not-granted origin → refused; CredentialStorePort spy 0", async () => {
    const creds = new FakeCredentialStore();
    const v = new MemoryIdentityVault(new MemorySecretStore(), new OriginAllowlist(), creds);
    await expect(v.capture("https://evil.test")).rejects.toThrow(/grant denied/);
    expect(creds.readCookieCalls).toBe(0);
    expect(creds.readStorageCalls).toBe(0);
  });

  it("capture: confirm-gate called once; second capture same origin skips confirm if fresh", async () => {
    const creds = new FakeCredentialStore();
    creds.seed(ORIGIN, [cookie()], storage());
    const gate = new DefaultConfirmGate();
    const seen: string[] = [];
    const wrapped = {
      mustConfirm: (intent: { kind: string }) => {
        seen.push(intent.kind);
        return gate.mustConfirm(intent as never);
      },
    };
    const clock = new FakeClock();
    clock.t = 1_000;
    const v = vault(creds, new OriginAllowlist(), { confirm: wrapped, clock, expiryHint: 1_000 + 60 * 60 * 1000 });
    await v.capture(ORIGIN);
    await v.capture(ORIGIN);
    expect(seen.filter((k) => k === "identity-capture")).toHaveLength(1);
  });

  it("restore: decrypt + writeCookies + writeStorage on allowed origin", async () => {
    const creds = new FakeCredentialStore();
    creds.seed(ORIGIN, [cookie()], storage());
    const v = vault(creds);
    await v.capture(ORIGIN);
    creds.cookies.delete(ORIGIN);
    creds.storage.delete(ORIGIN);
    await v.restore(ORIGIN);
    expect(creds.writeCookieCalls).toEqual([ORIGIN]);
    expect(creds.writeStorageCalls).toEqual([ORIGIN]);
    expect(creds.cookies.get(ORIGIN)?.[0]?.value).toBe(COOKIE_VAL);
  });

  it("restore: SSO chain — IdP origin restored before SP origin", async () => {
    const creds = new FakeCredentialStore();
    const allow = new OriginAllowlist();
    allow.grant(ORIGIN);
    allow.grant(IDP);
    creds.seed(ORIGIN, [cookie()], storage());
    creds.seed(IDP, [{ ...cookie(), domain: "idp.example.edu" }], storage());
    const v = new MemoryIdentityVault(new MemorySecretStore(), allow, creds);
    await v.capture(IDP);
    await v.capture(ORIGIN);
    v.setIdp(ORIGIN, IDP);
    creds.writeCookieCalls = [];
    await v.restore(ORIGIN);
    expect(creds.writeCookieCalls[0]).toBe(IDP);
    expect(creds.writeCookieCalls[1]).toBe(ORIGIN);
  });

  it("restore: expired bundle → Occupancy yield; CredentialStorePort.writeCookies spy 0 until re-authed", async () => {
    const creds = new FakeCredentialStore();
    creds.seed(ORIGIN, [cookie()], storage());
    const occupancy = new FakeOccupancy();
    const clock = new FakeClock();
    clock.t = 1_000;
    const v = vault(creds, new OriginAllowlist(), { occupancy, clock, expiryHint: 500 });
    await v.capture(ORIGIN);
    clock.t = 50_000;
    creds.writeCookieCalls = [];
    await expect(v.restore(ORIGIN)).rejects.toThrow(/expired/);
    expect(occupancy.operatorActive()).toBe(true);
    expect(creds.writeCookieCalls).toEqual([]);
  });

  it("restore: negotiateIWA origin → no writeCookies; verify LAUNCH flag set; CredentialStorePort spy 0", async () => {
    const creds = new FakeCredentialStore();
    creds.seed(ORIGIN, [cookie()], storage());
    const v = vault(creds);
    await v.capture(ORIGIN);
    v.setMethod(ORIGIN, "negotiateIWA");
    creds.writeCookieCalls = [];
    await v.restore(ORIGIN);
    expect(creds.writeCookieCalls).toEqual([]);
    expect(v.launchVerify.has(ORIGIN)).toBe(true);
  });

  it("forget: ciphertext deleted; SecretStore DEK ref removed; no log of deleted content", async () => {
    const creds = new FakeCredentialStore();
    creds.seed(ORIGIN, [cookie()], storage());
    const secrets = new MemorySecretStore();
    const allow = new OriginAllowlist();
    allow.grant(ORIGIN);
    const v = new MemoryIdentityVault(secrets, allow, creds);
    await v.capture(ORIGIN);
    const dekRef = v.dekRef(ORIGIN)!;
    await v.forget(ORIGIN);
    expect(v.ciphertext(ORIGIN)).toBeUndefined();
    expect(secrets.hasDek(dekRef)).toBe(false);
    expect(JSON.stringify(v.bundleRecord(ORIGIN) ?? {})).not.toContain(COOKIE_VAL);
  });

  it("status: returns fresh | expiring | expired | none per origin", async () => {
    const creds = new FakeCredentialStore();
    creds.seed(ORIGIN, [cookie()], storage());
    const clock = new FakeClock();
    clock.t = 1_000;
    const v = vault(creds, new OriginAllowlist(), { clock, expiryHint: 1_000 + 20 * 60 * 1000 });
    expect(await v.status(ORIGIN)).toBe("none");
    await v.capture(ORIGIN);
    expect(await v.status(ORIGIN)).toBe("fresh");
    clock.t = 1_000 + 15 * 60 * 1000;
    v.setExpiryHint(ORIGIN, 1_000 + 20 * 60 * 1000);
    expect(await v.status(ORIGIN)).toBe("expiring");
    clock.t = 1_000 + 21 * 60 * 1000;
    expect(await v.status(ORIGIN)).toBe("expired");
  });
});
