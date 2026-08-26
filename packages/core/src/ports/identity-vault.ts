import type { BundleStatus, Origin, VaultHandle } from "../types.ts";

export interface IdentityVault {
  capture(origin: Origin): Promise<VaultHandle>;
  restore(origin: Origin): Promise<void>;
  status(origin: Origin): Promise<BundleStatus>;
  forget(origin: Origin): Promise<void>;
}
