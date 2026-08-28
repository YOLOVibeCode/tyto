import { describe, expect, it } from "vitest";
import { CdpCredentialStore } from "../src/credentials.ts";
import { ScriptedCdp } from "./scripted-cdp.ts";

const ORIGIN = "https://hr.example.edu";

const SESSION = {
  name: "sessionid",
  value: "supersecretcookievalue",
  domain: "hr.example.edu",
  path: "/",
  httpOnly: true,
  secure: true,
};

describe("CDP CredentialStorePort", () => {
  it("readCookies uses Storage.getCookies, never document.cookie / Runtime.evaluate", async () => {
    const wire = new ScriptedCdp();
    wire.handlers.set("Storage.getCookies", () => ({
      cookies: [SESSION, { ...SESSION, name: "x", domain: "evil.test", value: "nope" }],
    }));
    const store = new CdpCredentialStore(wire);
    const cookies = await store.readCookies(ORIGIN);
    expect(wire.calls.map((c) => c.method)).toEqual(["Storage.getCookies"]);
    expect(JSON.stringify(wire.calls)).not.toMatch(/Runtime\.evaluate|document\.cookie/);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]?.name).toBe("sessionid");
    expect(cookies[0]?.httpOnly).toBe(true);
    expect(cookies.some((c) => c.domain.includes("evil"))).toBe(false);
  });

  it("readCookies: Storage.getCookies missing falls back to Network.getAllCookies", async () => {
    const wire = new ScriptedCdp();
    wire.handlers.set("Network.getAllCookies", () => ({ cookies: [SESSION] }));
    const store = new CdpCredentialStore(wire);
    const cookies = await store.readCookies(ORIGIN);
    expect(wire.calls.map((c) => c.method)).toEqual(["Storage.getCookies", "Network.getAllCookies"]);
    expect(cookies).toHaveLength(1);
  });

  it("writeCookies uses Storage.setCookies; does not Runtime.evaluate", async () => {
    const wire = new ScriptedCdp();
    wire.handlers.set("Storage.setCookies", () => ({}));
    const store = new CdpCredentialStore(wire);
    await store.writeCookies(ORIGIN, [SESSION]);
    expect(wire.calls.map((c) => c.method)).toEqual(["Storage.setCookies"]);
    expect(wire.calls[0]?.params).toMatchObject({
      cookies: [{ name: "sessionid", domain: "hr.example.edu", httpOnly: true, secure: true }],
    });
    expect(JSON.stringify(wire.calls)).not.toMatch(/Runtime\.evaluate|document\.cookie/);
  });

  it("writeCookies: Storage.setCookies missing falls back to Network.setCookie", async () => {
    const wire = new ScriptedCdp();
    wire.handlers.set("Network.setCookie", () => true);
    const store = new CdpCredentialStore(wire);
    await store.writeCookies(ORIGIN, [SESSION]);
    expect(wire.calls.map((c) => c.method)).toEqual(["Storage.setCookies", "Network.setCookie"]);
    expect(wire.calls[1]?.params).toMatchObject({
      name: "sessionid",
      domain: "hr.example.edu",
      httpOnly: true,
      secure: true,
    });
  });

  it("readStorage reads localStorage and sessionStorage via DOMStorage", async () => {
    const wire = new ScriptedCdp();
    wire.handlers.set("DOMStorage.getDOMStorageItems", (params) => {
      const id = (params as { storageId?: { isLocalStorage?: boolean } }).storageId;
      if (id?.isLocalStorage) return { entries: [["token", "abc"]] };
      return { entries: [["tab", "1"]] };
    });
    const store = new CdpCredentialStore(wire);
    const items = await store.readStorage(ORIGIN);
    expect(wire.calls.map((c) => c.method)).toEqual([
      "DOMStorage.getDOMStorageItems",
      "DOMStorage.getDOMStorageItems",
    ]);
    expect(items.localStorage).toEqual({ token: "abc" });
    expect(items.sessionStorage).toEqual({ tab: "1" });
    expect(items.indexedDb).toEqual({});
  });

  it("writeStorage sets DOMStorage items for local and session", async () => {
    const wire = new ScriptedCdp();
    wire.handlers.set("DOMStorage.setDOMStorageItem", () => ({}));
    const store = new CdpCredentialStore(wire);
    await store.writeStorage(ORIGIN, {
      localStorage: { k: "v" },
      sessionStorage: { s: "1" },
      indexedDb: {},
    });
    const methods = wire.calls.map((c) => c.method);
    expect(methods).toEqual(["DOMStorage.setDOMStorageItem", "DOMStorage.setDOMStorageItem"]);
    const local = wire.calls.find(
      (c) => (c.params as { storageId?: { isLocalStorage?: boolean } }).storageId?.isLocalStorage,
    );
    expect(local?.params).toMatchObject({ key: "k", value: "v" });
  });

  it("readStorage: DOMStorage failure yields empty maps, does not throw", async () => {
    const wire = new ScriptedCdp();
    const store = new CdpCredentialStore(wire);
    const items = await store.readStorage(ORIGIN);
    expect(items).toEqual({ localStorage: {}, sessionStorage: {}, indexedDb: {} });
    expect(wire.calls.some((c) => c.method === "Runtime.evaluate")).toBe(false);
  });

  it("clearCookies deletes only that origin's cookies", async () => {
    const wire = new ScriptedCdp();
    wire.handlers.set("Network.getAllCookies", () => ({
      cookies: [SESSION, { ...SESSION, name: "other", domain: "evil.test", value: "x" }],
    }));
    wire.handlers.set("Network.deleteCookies", () => ({}));
    const store = new CdpCredentialStore(wire);
    await store.clearCookies(ORIGIN);
    const deleted = wire.calls.filter((c) => c.method === "Network.deleteCookies");
    expect(deleted).toHaveLength(1);
    expect(deleted[0]?.params).toMatchObject({ name: "sessionid", domain: "hr.example.edu" });
    expect(deleted.some((c) => JSON.stringify(c.params).includes("evil"))).toBe(false);
    expect(wire.calls.some((c) => c.method === "Network.clearBrowserCookies")).toBe(false);
  });
});
