/**
 * Tier 2 — Live loop test.
 * Requires: TYTO_E2E=1 TYTO_LIVE=1
 * Run with: npm run test:e2e
 *
 * Flow:
 *  1. Start fixture-server and scripted-model server on loopback
 *  2. bootLive() — launches a real Chrome, starts the host
 *  3. SDK client: grantOrigin → page.goto → session.save → session.run
 *  4. Assert session file on disk contains the plan produced by the scripted model
 *  5. Independent verification: open a second raw CDP connection to confirm the
 *     browser actually navigated (DOM changed), without trusting the code under test
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freeLoopbackPort, bootLive } from "@tyto/host";
import { TytoClient } from "@tyto/sdk";
import { connectCdp, openLoopbackWebSocket } from "@tyto/cdp";
import { parseSession } from "@tyto/core";
import { startFixtureServer, type FixtureServer } from "../src/fixture-server.ts";
import { e2eLauncher, ensureLiveSpawn } from "../src/live-chrome.ts";
import { startScriptedModel, type ScriptedModelServer } from "../src/scripted-model.ts";

const LIVE = process.env.TYTO_E2E === "1" && process.env.TYTO_LIVE === "1";

describe.skipIf(!LIVE)("live loop — Tyto drives its own fixture pages", () => {
  let fixtures: FixtureServer;
  let model: ScriptedModelServer;
  let hostUrl: string;
  let hostToken: string;
  let debugPort: number;
  let profileDir: string;
  let sessionDir: string;
  let closeHost: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    [fixtures, model, debugPort] = await Promise.all([
      startFixtureServer(),
      startScriptedModel(),
      freeLoopbackPort(),
    ]);
    profileDir = await mkdtemp(join(tmpdir(), "tyto-e2e-profile-"));
    sessionDir = await mkdtemp(join(tmpdir(), "tyto-e2e-sessions-"));
    hostToken = "e2e-test-token-secure";

    const env: Record<string, string> = {
      TYTO_HOST_TOKEN: hostToken,
      TYTO_LIVE: "1",
      TYTO_PORT: "0",           // OS-assigned; avoids conflict with a running npm start
      TYTO_BASE_URL: model.baseUrl,
      TYTO_MODEL: "scripted-model",
      TYTO_DEBUG_PORT: String(debugPort),
      TYTO_PROFILE: profileDir,
      TYTO_SESSION_DIR: sessionDir,
    };

    // spawnBrowser reads process.env.TYTO_LIVE directly; set it for the launcher
    ensureLiveSpawn();

    const server = await bootLive(env, { launcher: e2eLauncher() });
    hostUrl = server.url;
    closeHost = () => server.close();
  });

  afterAll(async () => {
    await closeHost?.();
    await fixtures.close();
    await model.close();
    await rm(profileDir, { recursive: true, force: true });
    await rm(sessionDir, { recursive: true, force: true });
  });

  it("navigates to fixture page and runs session to completion", async () => {
    const client = new TytoClient({ url: hostUrl, token: hostToken });
    const targetUrl = `${fixtures.url}/result.html`;
    const origin = new URL(targetUrl).origin;
    const sessionId = `e2e-session-${Date.now()}`;

    // Grant origin, navigate, save session, run agent loop
    await client.call("operator.grantOrigin", { origin });
    await client.call("page.goto", { url: targetUrl });
    await client.call("session.save", {
      session: {
        id: sessionId,
        goal: "extract the answer from the result page",
        messages: [{ role: "user", content: "extract the answer from the result page" }],
        plan: null,
        recipes: [],
        answers: [],
        lastUrl: targetUrl,
        allowlist: [origin],
        model: { id: "scripted-model", baseUrl: model.baseUrl },
        vaultHandles: {},
        remainingSteps: [],
      },
    });

    const result = await client.call("session.run", { id: sessionId });
    expect(result).toBeDefined();

    // Read the persisted session and assert the plan/answers were written
    const sessionFile = join(sessionDir, `${sessionId}.json`);
    const raw = await readFile(sessionFile, "utf8");
    const session = parseSession(raw);
    expect(session).not.toBeNull();
    // The scripted model returned a plan; agent loop stores it in session.plan
    expect(session?.plan).not.toBeNull();
    expect(session?.plan?.steps.length).toBeGreaterThan(0);
  });

  it("independent CDP verification: browser actually navigated", async () => {
    const client = new TytoClient({ url: hostUrl, token: hostToken });
    const targetUrl = `${fixtures.url}/search.html`;
    const origin = new URL(targetUrl).origin;

    await client.call("operator.grantOrigin", { origin });
    await client.call("page.goto", { url: targetUrl });

    // Open a second raw CDP connection (independent of the code under test)
    const cdpBase = new URL(`http://127.0.0.1:${debugPort}`);
    const cdp = await connectCdp(cdpBase, openLoopbackWebSocket);

    // Get the list of targets to find the page
    const { targetInfos } = (await cdp.send("Target.getTargets", {})) as {
      targetInfos: Array<{ type: string; url: string; targetId: string }>;
    };

    const pageTargets = targetInfos.filter((t) => t.type === "page");
    expect(pageTargets.length).toBeGreaterThan(0);

    // At least one target should be our fixture page
    const navigated = pageTargets.some((t) => t.url.includes("/search.html"));
    expect(navigated).toBe(true);

    cdp.disconnect();
  });
});
