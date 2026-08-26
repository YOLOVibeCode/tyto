import type { BrowserHandle } from "./browser-handle.ts";

export type AttachOpts = { tabId?: string };

export interface Attacher {
  attach(opts: AttachOpts): Promise<BrowserHandle>;
}
