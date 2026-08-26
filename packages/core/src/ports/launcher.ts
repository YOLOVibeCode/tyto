import type { BrowserHandle } from "./browser-handle.ts";

export type LaunchOpts = {
  browser: "chrome" | "edge";
  userDataDir: string;
  port: number;
  bindHost: string;
  authServerAllowlist?: string[];
};

export interface Launcher {
  launch(opts: LaunchOpts): Promise<BrowserHandle>;
}
