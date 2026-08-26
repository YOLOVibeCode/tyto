import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import type { IdentityVault } from "@tyto/core/ports";
import type { BundleStatus, Origin, VaultHandle } from "@tyto/core";
import { bundleStatus } from "@tyto/core";

export interface SecretStore {
  getDek(): Buffer;
}

/** In-memory DEK. Production wraps this with the OS keychain. */
export class MemorySecretStore implements SecretStore {
  private readonly dek: Buffer;
  constructor(passphrase = "tyto-test-dek-not-for-production") {
    this.dek = scryptSync(passphrase, "tyto-vault", 32);
  }
  getDek(): Buffer {
    return this.dek;
  }
}

type Recorded = { iv: string; ct: string; capturedAt: number; expiryHint?: number; idp?: Origin };

export class MemoryIdentityVault implements IdentityVault {
  private readonly records = new Map<Origin, Recorded>();
  private n = 0;
  clock = { now: () => Date.now(), sleep: async () => undefined };

  constructor(
    private readonly secrets: SecretStore,
    private readonly allow: Set<Origin>,
    private readonly store: {
      read: (o: Origin) => Promise<{ cookies: unknown; storage: unknown }>;
      write: (o: Origin, data: { cookies: unknown; storage: unknown }) => Promise<void>;
    },
  ) {}

  async capture(origin: Origin): Promise<VaultHandle> {
    if (!this.allow.has(origin)) throw new Error("identity grant denied");
    const payload = JSON.stringify(await this.store.read(origin));
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.secrets.getDek(), iv);
    const enc = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const ct = Buffer.concat([enc, tag]).toString("base64");
    this.records.set(origin, { iv: iv.toString("base64"), ct, capturedAt: this.clock.now() });
    this.n += 1;
    return `vault_${this.n}`;
  }

  async restore(origin: Origin): Promise<void> {
    if (!this.allow.has(origin)) throw new Error("identity grant denied");
    const rec = this.records.get(origin);
    if (!rec) throw new Error("no bundle");
    const st = bundleStatus(rec, this.clock);
    if (st === "expired") throw new Error("expired");
    const recIdp = rec.idp;
    if (recIdp && recIdp !== origin) await this.restore(recIdp);
    const buf = Buffer.from(rec.ct, "base64");
    const data = buf.subarray(0, buf.length - 16);
    const tag = buf.subarray(buf.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", this.secrets.getDek(), Buffer.from(rec.iv, "base64"));
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    await this.store.write(origin, JSON.parse(json) as { cookies: unknown; storage: unknown });
  }

  async status(origin: Origin): Promise<BundleStatus> {
    return bundleStatus(this.records.get(origin) ?? null, this.clock);
  }

  async forget(origin: Origin): Promise<void> {
    this.records.delete(origin);
  }

  /** Test helper: ciphertext blob, never the cookie value. */
  ciphertext(origin: Origin): string | undefined {
    return this.records.get(origin)?.ct;
  }

  setIdp(sp: Origin, idp: Origin): void {
    const rec = this.records.get(sp);
    if (rec) rec.idp = idp;
  }
}
