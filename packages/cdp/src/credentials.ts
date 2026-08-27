import type { CredentialStorePort, Origin, RawCookie, RawStorageItems } from "@tyto/core";
import { asRecord, cdpCall, type CdpWire } from "./wire.ts";

export class CdpCredentialStore implements CredentialStorePort {
  constructor(private readonly wire: CdpWire) {}

  async readCookies(origin: Origin): Promise<RawCookie[]> {
    const raw = await cdpCall(this.wire, "Network.getAllCookies", {}, undefined);
    return cookiesFrom(raw).filter((c) => cookieMatchesOrigin(c.domain, origin));
  }

  async writeCookies(origin: Origin, cookies: RawCookie[]): Promise<void> {
    const url = origin.endsWith("/") ? origin : `${origin}/`;
    for (const c of cookies) {
      await cdpCall(
        this.wire,
        "Network.setCookie",
        {
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          httpOnly: c.httpOnly,
          secure: c.secure,
          url,
        },
        undefined,
      );
    }
  }

  async readStorage(origin: Origin): Promise<RawStorageItems> {
    const local = await cdpCall(
      this.wire,
      "DOMStorage.getDOMStorageItems",
      { storageId: { securityOrigin: origin, isLocalStorage: true } },
      undefined,
    );
    const session = await cdpCall(
      this.wire,
      "DOMStorage.getDOMStorageItems",
      { storageId: { securityOrigin: origin, isLocalStorage: false } },
      undefined,
    );
    return {
      localStorage: entriesToRecord(local),
      sessionStorage: entriesToRecord(session),
      indexedDb: {},
    };
  }

  async writeStorage(origin: Origin, items: RawStorageItems): Promise<void> {
    await writeMap(this.wire, origin, true, items.localStorage);
    await writeMap(this.wire, origin, false, items.sessionStorage);
  }

  async clearCookies(origin: Origin): Promise<void> {
    const cookies = await this.readCookies(origin);
    for (const c of cookies) {
      await cdpCall(
        this.wire,
        "Network.deleteCookies",
        { name: c.name, domain: c.domain, path: c.path },
        undefined,
      );
    }
  }
}

async function writeMap(
  wire: CdpWire,
  origin: Origin,
  isLocalStorage: boolean,
  items: Record<string, string>,
): Promise<void> {
  for (const [key, value] of Object.entries(items)) {
    await cdpCall(
      wire,
      "DOMStorage.setDOMStorageItem",
      { storageId: { securityOrigin: origin, isLocalStorage }, key, value },
      undefined,
    );
  }
}

function cookiesFrom(raw: unknown): RawCookie[] {
  const list = asRecord(raw)?.cookies;
  if (!Array.isArray(list)) return [];
  const out: RawCookie[] = [];
  for (const item of list) {
    const rec = asRecord(item);
    if (!rec) continue;
    if (typeof rec.name !== "string" || typeof rec.value !== "string") continue;
    if (typeof rec.domain !== "string" || typeof rec.path !== "string") continue;
    out.push({
      name: rec.name,
      value: rec.value,
      domain: rec.domain,
      path: rec.path,
      httpOnly: rec.httpOnly === true,
      secure: rec.secure === true,
    });
  }
  return out;
}

export function cookieMatchesOrigin(domain: string, origin: Origin): boolean {
  const host = new URL(origin).hostname.toLowerCase();
  const d = domain.replace(/^\./, "").toLowerCase();
  return host === d || host.endsWith(`.${d}`);
}

function entriesToRecord(raw: unknown): Record<string, string> {
  const entries = asRecord(raw)?.entries;
  const out: Record<string, string> = {};
  if (!Array.isArray(entries)) return out;
  for (const row of entries) {
    if (!Array.isArray(row)) continue;
    const key = row[0];
    const value = row[1];
    if (typeof key === "string" && typeof value === "string") out[key] = value;
  }
  return out;
}
