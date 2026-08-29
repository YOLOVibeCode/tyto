export type CdpTransport = {
  send(text: string): void;
  subscribe(fn: (text: string) => void): () => void;
  close?: () => void;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

/** JSON-RPC 2.0 multiplexer over a byte transport. Owns request ids. */
export class JsonRpcCdp {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly unsub: () => void;
  private readonly eventListeners = new Set<(method: string, params: unknown, sessionId?: string) => void>();

  constructor(private readonly transport: CdpTransport) {
    this.unsub = transport.subscribe((text) => this.onMessage(text));
  }

  onEvent(fn: (method: string, params: unknown, sessionId?: string) => void): () => void {
    this.eventListeners.add(fn);
    return () => {
      this.eventListeners.delete(fn);
    };
  }

  async send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown> {
    const id = this.nextId++;
    const msg: Record<string, unknown> = { id, method };
    if (params !== undefined) msg.params = params;
    if (sessionId !== undefined) msg.sessionId = sessionId;
    return await new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.transport.send(JSON.stringify(msg));
    });
  }

  disconnect(): void {
    this.unsub();
    this.transport.close?.();
    for (const p of this.pending.values()) p.reject(new Error("disconnected"));
    this.pending.clear();
  }

  private onMessage(text: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    const msg = parsed as Record<string, unknown>;
    if (typeof msg.method === "string" && typeof msg.id !== "number") {
      const sid = typeof msg.sessionId === "string" ? msg.sessionId : undefined;
      for (const fn of this.eventListeners) {
        if (sid !== undefined) fn(msg.method, msg.params, sid);
        else fn(msg.method, msg.params);
      }
      return;
    }
    if (typeof msg.id !== "number") return;
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    if (msg.error !== undefined && msg.error !== null) {
      const err = msg.error;
      const message =
        err && typeof err === "object" && !Array.isArray(err) && typeof (err as { message?: unknown }).message === "string"
          ? (err as { message: string }).message
          : "cdp error";
      pending.reject(new Error(message));
      return;
    }
    pending.resolve(msg.result);
  }
}
