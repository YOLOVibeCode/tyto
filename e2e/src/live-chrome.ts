/**
 * Shared live-Chrome helpers for e2e tests.
 *
 * spawnBrowser reads process.env.TYTO_LIVE directly (not the bootLive env dict).
 * Chrome on macOS needs longer than the default 2s waitForJsonVersion budget.
 */
import { CdpLauncher, spawnBrowser } from "@tyto/cdp";

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
