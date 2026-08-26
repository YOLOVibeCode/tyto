import type { Origin, RawCookie, RawStorageItems } from "../types.ts";

export interface CredentialStorePort {
  readCookies(origin: Origin): Promise<RawCookie[]>;
  writeCookies(origin: Origin, cookies: RawCookie[]): Promise<void>;
  readStorage(origin: Origin): Promise<RawStorageItems>;
  writeStorage(origin: Origin, items: RawStorageItems): Promise<void>;
  clearCookies(origin: Origin): Promise<void>;
}
