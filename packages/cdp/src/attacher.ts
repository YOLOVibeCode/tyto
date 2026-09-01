import type { Attacher, AttachOpts, BrowserHandle } from "@tyto/core";

export class ExtensionAttacher implements Attacher {
  constructor(private readonly post: (msg: unknown) => Promise<unknown>) {}

  async attach(opts: AttachOpts): Promise<BrowserHandle> {
    const tabId = Number(opts.tabId ?? "");
    if (!Number.isFinite(tabId) || tabId <= 0) throw new Error("tabId required");
    const post = this.post;
    const out = await post({ type: "attach", tabId });
    if (out && typeof out === "object" && "error" in out) {
      throw new Error(String((out as { error: unknown }).error));
    }
    const cdp = {
      send: (method: string, params?: Record<string, unknown>) => {
        const msg: Record<string, unknown> = { type: "cdp", method };
        if (params !== undefined) msg.params = params;
        return post(msg);
      },
    };
    const handle: BrowserHandle & {
      cdp: { send: (method: string, params?: Record<string, unknown>) => Promise<unknown> };
      pageSessionId: string;
    } = {
      cdp,
      pageSessionId: "",
      disconnect: async () => {
        await post({ type: "detach" });
      },
    };
    return handle;
  }
}
