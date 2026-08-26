import { describe, expect, it } from "vitest";
import { MemoryIdentityVault, MemorySecretStore } from "../src/index.ts";

describe("MemoryIdentityVault", () => {
  it("capture then restore round-trips; ciphertext is not plaintext cookies", async () => {
    const cookies = [{ name: "sessionid", value: "supersecretcookievalue", domain: "ex.test", path: "/", httpOnly: true, secure: true }];
    const mem = new Map<string, { cookies: unknown; storage: unknown }>();
    const store = {
      read: async (o: string) => mem.get(o) ?? { cookies, storage: { localStorage: {}, sessionStorage: {}, indexedDb: {} } },
      write: async (o: string, data: { cookies: unknown; storage: unknown }) => {
        mem.set(o, data);
      },
    };
    const origin = "https://ex.test";
    const vault = new MemoryIdentityVault(new MemorySecretStore(), new Set([origin]), store);
    const handle = await vault.capture(origin);
    expect(handle.startsWith("vault_")).toBe(true);
    expect(vault.ciphertext(origin)).toBeTruthy();
    expect(vault.ciphertext(origin)).not.toContain("supersecretcookievalue");
    mem.clear();
    await vault.restore(origin);
    const written = mem.get(origin) as { cookies: Array<{ value: string }> };
    expect(written.cookies[0]?.value).toBe("supersecretcookievalue");
  });

  it("capture on a not-granted origin is refused", async () => {
    const vault = new MemoryIdentityVault(
      new MemorySecretStore(),
      new Set(),
      { read: async () => ({ cookies: [], storage: {} }), write: async () => undefined },
    );
    await expect(vault.capture("https://evil.test")).rejects.toThrow(/grant denied/);
  });
});
