import type { Navigation } from "@tyto/core";
import { cdpCall, type CdpWire } from "./wire.ts";

export class CdpNavigation implements Navigation {
  private url = new URL("about:blank");

  constructor(
    private readonly wire: CdpWire,
    private readonly sessionId: () => string | undefined,
  ) {}

  async goto(url: URL): Promise<void> {
    const sid = this.sessionId();
    await cdpCall(this.wire, "Page.enable", {}, sid);
    await cdpCall(this.wire, "Page.navigate", { url: url.href }, sid);
    this.url = url;
  }

  async currentUrl(): Promise<URL> {
    return this.url;
  }
}
