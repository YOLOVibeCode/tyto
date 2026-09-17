/**
 * Shared live-Chrome helpers for e2e tests.
 *
 * spawnBrowser reads process.env.TYTO_LIVE directly (not the bootLive env dict).
 * Chrome on macOS needs longer than the default 2s waitForJsonVersion budget.
 */
import { access } from "node:fs/promises";
import { join } from "node:path";
import type { Launcher } from "@tyto/core";
import { CdpLauncher, resolveBrowserBinary, spawnBrowser } from "@tyto/cdp";
import { chromium } from "@playwright/test";

export function ensureLiveSpawn(): void {
  process.env.TYTO_LIVE = "1";
}

export function e2eLauncher(): CdpLauncher {
  return new CdpLauncher({
    spawn: (binary, args) =>
      spawnBrowser(binary, [...args, "--headless=new", "--disable-gpu", "--disable-extensions"]),
    pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms * 6)),
  });
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

export async function findChromeBinary(): Promise<string> {
  return resolveBrowserBinary("chrome", process.platform, pathExists, lookupOnPath);
}

/**
 * Branded Google Chrome 137+ ignores --load-extension. Chrome for Testing
 * (Playwright's Chromium) still honors it, which is required for native messaging.
 */
export async function findExtensionCapableBrowser(): Promise<string> {
  const path = chromium.executablePath();
  try {
    await access(path);
  } catch {
    throw new Error(
      "live attach requires Playwright Chromium (Google Chrome ignores --load-extension). Run: npx playwright install chromium",
    );
  }
  return path;
}

/**
 * Spawn headed Chrome for Testing with --load-extension and no page CDP session.
 * Do not wait on the fixture here — bootLive would surface that as a generic
 * RPC error. The test waits for native attach, then navigates.
 */
export function attachOnlyLauncher(startUrl: string): Launcher {
  return {
    async launch(opts) {
      const binary = await findExtensionCapableBrowser();
      const args = [
        `--user-data-dir=${opts.userDataDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-features=DisableLoadExtensionCommandLineSwitch",
        "--silent-debugger-extension-api",
      ];
      if (opts.extensionDir !== undefined && opts.extensionDir !== "") {
        args.push(`--load-extension=${opts.extensionDir}`);
      }
      args.push(startUrl);
      const child = spawnBrowser(binary, args);
      return {
        disconnect: async () => {
          child.kill();
        },
      };
    },
  };
}

export function nativeHostDirForThrowaway(profileDir: string): string {
  return join(profileDir, "NativeMessagingHosts");
}

/** Poll until `/json/version` is unreachable — Chrome has released the debug port. */
export async function waitUntilCdpGone(port: number): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(300),
      });
      if (!res.ok) return;
    } catch {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("CDP still reachable after disconnect");
}
