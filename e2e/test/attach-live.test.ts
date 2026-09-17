/**
 * Slice 11 live — attach on a throwaway profile.
 * Requires: TYTO_E2E=1 TYTO_LIVE=1
 *
 * Operator path is side panel Attach → chrome.debugger (banner) → page.snapshot.
 * Playwright and CdpLauncher both Target.attachToTarget, which blocks
 * chrome.debugger.attach, so this test drives the same RPC the Attach button
 * sends (browser.attach + tab id) against a real host + native bridge + MV3.
 *
 * Independent check: the fixture HTTP server saw GET /attach.html (Chrome
 * fetched it; no page CDP). The beacon string exists only on that page.
 *
 * Uses Chrome for Testing: branded Google Chrome ignores --load-extension.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootLive, freeLoopbackPort } from "@tyto/host";
import { TytoClient } from "@tyto/sdk";
import { startFixtureServer, type FixtureServer } from "../src/fixture-server.ts";
import {
  attachOnlyLauncher,
  ensureLiveSpawn,
  nativeHostDirForThrowaway,
} from "../src/live-chrome.ts";

const LIVE = process.env.TYTO_E2E === "1" && process.env.TYTO_LIVE === "1";

describe.skipIf(!LIVE)("live attach — throwaway profile", () => {
  let fixtures: FixtureServer;
  let hostUrl: string;
  let hostToken: string;
  let debugPort: number;
  let profileDir: string;
  let sessionDir: string;
  let authDir: string;
  let closeHost: (() => Promise<void>) | undefined;
  let origin: string;
  let targetUrl: string;

  beforeAll(async () => {
    [fixtures, debugPort] = await Promise.all([startFixtureServer(), freeLoopbackPort()]);
    profileDir = await mkdtemp(join(tmpdir(), "tyto-attach-profile-"));
    sessionDir = await mkdtemp(join(tmpdir(), "tyto-attach-sessions-"));
    authDir = await mkdtemp(join(tmpdir(), "tyto-attach-auth-"));
    hostToken = "e2e-attach-token-secure";
    targetUrl = `${fixtures.url}/attach.html`;
    origin = new URL(targetUrl).origin;

    const hostsDir = nativeHostDirForThrowaway(profileDir);

    ensureLiveSpawn();
    const server = await bootLive(
      {
        TYTO_HOST_TOKEN: hostToken,
        TYTO_LIVE: "1",
        TYTO_E2E: "1",
        TYTO_EXTENSION: "1",
        TYTO_PORT: "0",
        TYTO_DEBUG_PORT: String(debugPort),
        TYTO_PROFILE: profileDir,
        TYTO_SESSION_DIR: sessionDir,
        TYTO_NATIVE_HOST_DIR: hostsDir,
        TYTO_NATIVE_AUTH: join(authDir, "native-auth.json"),
        TYTO_OPEN_URL: targetUrl,
      },
      { launcher: attachOnlyLauncher(targetUrl) },
    );
    hostUrl = server.url;
    closeHost = () => server.close();
    const auth = JSON.parse(await readFile(join(authDir, "native-auth.json"), "utf8")) as {
      openUrl?: string;
    };
    if (auth.openUrl !== targetUrl) {
      throw new Error("native auth missing loopback openUrl");
    }
    if (server.nativeConnected === undefined) {
      throw new Error("bootLive did not start the native bridge");
    }
    await Promise.race([
      server.nativeConnected,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("native host did not connect")), 20_000);
      }),
    ]);
  });

  afterAll(async () => {
    await closeHost?.();
    await fixtures.close();
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    await rm(sessionDir, { recursive: true, force: true }).catch(() => {});
    await rm(authDir, { recursive: true, force: true }).catch(() => {});
  });

  it("page.snapshot fails closed until Attach, then AX contains the fixture beacon", async () => {
    const client = new TytoClient({ url: hostUrl, token: hostToken });
    const frame = { tabId: "t", frameId: "main", origin };

    await expect(client.call("page.snapshot", frame)).rejects.toThrow(/perception not attached/i);

    await attachWhenReady(client);
    await client.call("operator.grantOrigin", { origin });
    await client.call("page.goto", { url: targetUrl }, AbortSignal.timeout(15_000));
    await fixtures.waitFor("/attach.html");
    const snap = (await client.call("page.snapshot", frame, AbortSignal.timeout(15_000))) as {
      tree: string;
    };
    expect(snap.tree).toContain("TytoAttachBeacon");
    expect(JSON.stringify(snap)).not.toMatch(/screenshot|data:image/i);
  });
});

async function attachWhenReady(client: TytoClient): Promise<void> {
  const deadline = Date.now() + 45_000;
  const seen = new Set<string>();
  while (Date.now() < deadline) {
    for (let tabId = 1; tabId <= 8; tabId += 1) {
      try {
        await client.call("browser.attach", { tabId: String(tabId) }, AbortSignal.timeout(5_000));
        return;
      } catch (err) {
        seen.add(err instanceof Error ? err.message : String(err));
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 400));
  }
  throw new Error([...seen].join("; ") || "attach timeout");
}
