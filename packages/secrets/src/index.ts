import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { bundleStatus, type Allowlist, type AuthMethod, type BundleStatus, type Clock, type ConfirmGate, type CredentialStorePort, type IdentityVault, type Occupancy, type Origin, type VaultHandle } from "@tyto/core";

export interface SecretStore {
  getDek(ref?: string): Buffer;
  putDek(ref: string, dek: Buffer): void;
  deleteDek(ref: string): void;
  hasDek(ref: string): boolean;
}

/** In-memory DEK. Production wraps this with the OS keychain. */
export class MemorySecretStore implements SecretStore {
  private readonly root: Buffer;
  private readonly refs = new Map<string, Buffer>();

  constructor(passphrase = "tyto-test-dek-not-for-production") {
    this.root = scryptSync(passphrase, "tyto-vault", 32);
  }

  getDek(ref = "default"): Buffer {
    if (ref === "default") return this.root;
    const hit = this.refs.get(ref);
    if (!hit) throw new Error("no dek");
    return hit;
  }

  putDek(ref: string, dek: Buffer): void {
    this.refs.set(ref, dek);
  }

  deleteDek(ref: string): void {
    this.refs.delete(ref);
  }

  hasDek(ref: string): boolean {
    return this.refs.has(ref);
  }
}

type Recorded = {
  iv: string;
  ct: string;
  capturedAt: number;
  dekRef: string;
  expiryHint?: number;
  idp?: Origin;
  method?: AuthMethod;
};

export type VaultOpts = {
  confirm?: ConfirmGate;
  occupancy?: Occupancy;
  clock?: Clock;
  expiryHint?: number;
};

function permits(allow: Allowlist | Set<Origin>, origin: Origin): boolean {
  if (allow instanceof Set) return allow.has(origin);
  return allow.permits(new URL(`${origin}/`));
}

export class MemoryIdentityVault implements IdentityVault {
  private readonly records = new Map<Origin, Recorded>();
  private readonly confirmed = new Set<Origin>();
  private n = 0;
  readonly launchVerify = new Set<Origin>();

  constructor(
    private readonly secrets: SecretStore,
    private readonly allow: Allowlist | Set<Origin>,
    private readonly creds: CredentialStorePort,
    private readonly opts: VaultOpts = {},
  ) {}

  private clock(): Clock {
    return this.opts.clock ?? { now: () => Date.now(), sleep: async () => undefined };
  }

  async capture(origin: Origin): Promise<VaultHandle> {
    if (!permits(this.allow, origin)) throw new Error("identity grant denied");
    const existing = this.records.get(origin);
    const fresh = existing ? bundleStatus(existing, this.clock()) === "fresh" : false;
    if (!fresh || !this.confirmed.has(origin)) {
      this.opts.confirm?.mustConfirm({ kind: "identity-capture", url: origin });
      this.confirmed.add(origin);
    }
    const payload = JSON.stringify({
      cookies: await this.creds.readCookies(origin),
      storage: await this.creds.readStorage(origin),
    });
    const dek = randomBytes(32);
    const dekRef = `dek_${++this.n}`;
    this.secrets.putDek(dekRef, dek);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", dek, iv);
    const enc = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const ct = Buffer.concat([enc, tag]).toString("base64");
    const rec: Recorded = { iv: iv.toString("base64"), ct, capturedAt: this.clock().now(), dekRef };
    if (this.opts.expiryHint !== undefined) rec.expiryHint = this.opts.expiryHint;
    const prior = this.records.get(origin);
    if (prior?.idp) rec.idp = prior.idp;
    if (prior?.method) rec.method = prior.method;
    this.records.set(origin, rec);
    return `vault_${this.n}`;
  }

  async restore(origin: Origin): Promise<void> {
    if (!permits(this.allow, origin)) throw new Error("identity grant denied");
    const rec = this.records.get(origin);
    if (!rec) throw new Error("no bundle");
    const st = bundleStatus(rec, this.clock());
    if (st === "expired") {
      this.opts.occupancy?.yieldToOperator();
      throw new Error("expired");
    }
    if (rec.method === "negotiateIWA") {
      this.launchVerify.add(origin);
      return;
    }
    const recIdp = rec.idp;
    if (recIdp && recIdp !== origin) await this.restore(recIdp);
    const dek = this.secrets.getDek(rec.dekRef);
    const buf = Buffer.from(rec.ct, "base64");
    const data = buf.subarray(0, buf.length - 16);
    const tag = buf.subarray(buf.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", dek, Buffer.from(rec.iv, "base64"));
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    const body = JSON.parse(json) as { cookies: Parameters<CredentialStorePort["writeCookies"]>[1]; storage: Parameters<CredentialStorePort["writeStorage"]>[1] };
    await this.creds.writeCookies(origin, body.cookies);
    await this.creds.writeStorage(origin, body.storage);
  }

  async status(origin: Origin): Promise<BundleStatus> {
    return bundleStatus(this.records.get(origin) ?? null, this.clock());
  }

  async forget(origin: Origin): Promise<void> {
    const rec = this.records.get(origin);
    if (rec) this.secrets.deleteDek(rec.dekRef);
    this.records.delete(origin);
    this.confirmed.delete(origin);
  }

  ciphertext(origin: Origin): string | undefined {
    return this.records.get(origin)?.ct;
  }

  dekRef(origin: Origin): string | undefined {
    return this.records.get(origin)?.dekRef;
  }

  bundleRecord(origin: Origin): Recorded | undefined {
    return this.records.get(origin);
  }

  setIdp(sp: Origin, idp: Origin): void {
    const rec = this.records.get(sp);
    if (rec) rec.idp = idp;
  }

  setMethod(origin: Origin, method: AuthMethod): void {
    const rec = this.records.get(origin);
    if (rec) rec.method = method;
  }

  setExpiryHint(origin: Origin, expiryHint: number): void {
    const rec = this.records.get(origin);
    if (rec) rec.expiryHint = expiryHint;
  }
}
