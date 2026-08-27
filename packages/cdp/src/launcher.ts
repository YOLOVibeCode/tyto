import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserHandle, LaunchOpts, Launcher } from "@tyto/core";
import { chromeLaunchArgs } from "./launch-args.ts";
import { connectCdp, waitForJsonVersion, type OpenCdpSocket } from "./json-version.ts";
import { JsonRpcCdp } from "./jsonrpc.ts";
import { attachPageSession } from "./page-session.ts";
import { openLoopbackWebSocket } from "./websocket.ts";

export type SpawnedBrowser = { kill: () => void };

export type LauncherDeps = {
  resolveBinary: (browser: LaunchOpts["browser"]) => Promise<string>;
  spawn: (binary: string, args: string[]) => SpawnedBrowser | Promise<SpawnedBrowser>;
  open: OpenCdpSocket;
  pause?: (ms: number) => Promise<void>;
};

export class CdpBrowserHandle implements BrowserHandle {
  constructor(
    readonly cdp: JsonRpcCdp,
    private readonly child: SpawnedBrowser,
    readonly pageSessionId: string,
  ) {}

  async disconnect(): Promise<void> {
    this.cdp.disconnect();
    this.child.kill();
  }
}

export class CdpLauncher implements Launcher {
  private readonly resolveBinary: LauncherDeps["resolveBinary"];
  private readonly spawnFn: LauncherDeps["spawn"];
  private readonly open: OpenCdpSocket;
  private readonly pause: (ms: number) => Promise<void>;

  constructor(deps?: Partial<LauncherDeps>) {
    this.resolveBinary =
      deps?.resolveBinary ?? ((browser) => resolveBrowserBinary(browser, process.platform, pathExists, lookupOnPath));
    this.spawnFn = deps?.spawn ?? spawnBrowser;
    this.open = deps?.open ?? ((url) => openLoopbackWebSocket(url));
    this.pause = deps?.pause ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async launch(opts: LaunchOpts): Promise<CdpBrowserHandle> {
    const args = chromeLaunchArgs(opts);
    const binary = await this.resolveBinary(opts.browser);
    const child = await this.spawnFn(binary, args);
    const httpBase = new URL(`http://${opts.bindHost}:${String(opts.port)}/`);
    try {
      await waitForJsonVersion(httpBase, this.pause);
      const cdp = await connectCdp(httpBase, this.open);
      const pageSessionId = await attachPageSession(cdp);
      return new CdpBrowserHandle(cdp, child, pageSessionId);
    } catch (err) {
      child.kill();
      throw err;
    }
  }
}

/** Real process spawn. Airplane-mode tests inject a fake. */
export function spawnBrowser(binary: string, args: string[]): SpawnedBrowser {
  if (process.env.TYTO_LIVE !== "1") {
    throw new Error("browser spawn is opt-in (TYTO_LIVE=1)");
  }
  const child = spawn(binary, args, { stdio: "ignore" });
  return {
    kill(): void {
      child.kill();
    },
  };
}

export async function resolveBrowserBinary(
  browser: LaunchOpts["browser"],
  platform: NodeJS.Platform,
  exists: (path: string) => Promise<boolean>,
  which: (cmd: string) => Promise<string | undefined>,
): Promise<string> {
  for (const candidate of binaryCandidates(browser, platform)) {
    if (await exists(candidate)) return candidate;
  }
  for (const cmd of pathCommands(browser)) {
    const hit = await which(cmd);
    if (hit) return hit;
  }
  throw new Error("browser binary not found");
}

function binaryCandidates(browser: LaunchOpts["browser"], platform: NodeJS.Platform): string[] {
  if (platform === "darwin") {
    return browser === "edge"
      ? ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
      : ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  }
  if (browser === "edge") {
    return ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable"];
  }
  return ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium"];
}

function pathCommands(browser: LaunchOpts["browser"]): string[] {
  return browser === "edge" ? ["microsoft-edge", "msedge"] : ["google-chrome", "google-chrome-stable", "chromium", "chrome"];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function lookupOnPath(cmd: string): Promise<string | undefined> {
  const pathEnv = process.env.PATH ?? "";
  const sep = pathEnv.includes(";") && !pathEnv.includes(":") ? ";" : ":";
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue;
    const candidate = join(dir, cmd);
    if (await pathExists(candidate)) return candidate;
  }
  return undefined;
}
