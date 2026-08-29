/**
 * Slice 13 live — weave occupancy.
 * Requires: TYTO_E2E=1 TYTO_LIVE=1
 *
 * Operator types into the same field the agent would fill. Mid-keystroke the
 * agent must yield. After the operator pauses, the loop resumes from a fresh
 * snapshot.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectCdp, openLoopbackWebSocket, WEAVE_IDLE_MS } from "@tyto/cdp";
import { bootLive, freeLoopbackPort } from "@tyto/host";
import { TytoClient } from "@tyto/sdk";
import { startFixtureServer, type FixtureServer } from "../src/fixture-server.ts";
import { e2eLauncher, ensureLiveSpawn } from "../src/live-chrome.ts";
import { startScriptedModel, type ScriptedModelServer } from "../src/scripted-model.ts";

const LIVE = process.env.TYTO_E2E === "1" && process.env.TYTO_LIVE === "1";
const OPERATOR = "op-weave";
const AGENT = "agent-overwrite";

describe.skipIf(!LIVE)("weave occupancy — live", () => {
  let fixtures: FixtureServer;
  let model: ScriptedModelServer;
  let hostUrl: string;
  let hostToken: string;
  let debugPort: number;
  let profileDir: string;
  let sessionDir: string;
  let closeHost: (() => Promise<void>) | undefined;
  let origin: string;

  beforeAll(async () => {
    [fixtures, model, debugPort] = await Promise.all([
      startFixtureServer(),
      startScriptedModel(),
      freeLoopbackPort(),
    ]);
    profileDir = await mkdtemp(join(tmpdir(), "tyto-weave-profile-"));
    sessionDir = await mkdtemp(join(tmpdir(), "tyto-weave-sessions-"));
    hostToken = "e2e-weave-token-secure";
    origin = fixtures.url;
    ensureLiveSpawn();
    const server = await bootLive(
      {
        TYTO_HOST_TOKEN: hostToken,
        TYTO_LIVE: "1",
        TYTO_PORT: "0",
        TYTO_BASE_URL: model.baseUrl,
        TYTO_MODEL: "scripted-model",
        TYTO_DEBUG_PORT: String(debugPort),
        TYTO_PROFILE: profileDir,
        TYTO_SESSION_DIR: sessionDir,
      },
      { launcher: e2eLauncher() },
    );
    hostUrl = server.url;
    closeHost = () => server.close();
  });

  afterAll(async () => {
    await closeHost?.();
    await fixtures.close();
    await model.close();
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    await rm(sessionDir, { recursive: true, force: true }).catch(() => {});
  });

  it("without operator input, agent fills the query box", async () => {
    const client = new TytoClient({ url: hostUrl, token: hostToken });
    const url = `${fixtures.url}/search.html`;
    await client.call("operator.grantOrigin", { origin });
    await client.call("page.goto", { url });
    await waitForPageUrl(debugPort, "/search.html");
    const sessionId = `weave-fill-${Date.now()}`;
    const fill = await queryBoxStep(client, origin, AGENT);
    await client.call("session.save", {
      session: {
        id: sessionId,
        goal: "fill search",
        messages: [{ role: "user", content: "fill search" }],
        plan: null,
        recipes: [],
        answers: [],
        lastUrl: url,
        allowlist: [origin],
        model: { id: "scripted-model", baseUrl: model.baseUrl },
        vaultHandles: {},
        remainingSteps: [fill],
      },
    });
    await client.call("session.run", { id: sessionId });
    const value = await inputValue(debugPort);
    expect(value).toBe(AGENT);
  });

  it("live: type in the same textbox the agent targeted; agent does not overwrite", async () => {
    const client = new TytoClient({ url: hostUrl, token: hostToken });
    const url = `${fixtures.url}/search.html`;
    await client.call("operator.grantOrigin", { origin });
    await client.call("page.goto", { url });
    await waitForPageUrl(debugPort, "/search.html");
    await typeAsOperator(debugPort, OPERATOR);
    expect(await inputValue(debugPort)).toBe(OPERATOR);

    const sessionId = `weave-yield-${Date.now()}`;
    const fill = await queryBoxStep(client, origin, AGENT);
    await client.call("session.save", {
      session: {
        id: sessionId,
        goal: "fill search",
        messages: [{ role: "user", content: "fill search" }],
        plan: null,
        recipes: [],
        answers: [],
        lastUrl: url,
        allowlist: [origin],
        model: { id: "scripted-model", baseUrl: model.baseUrl },
        vaultHandles: {},
        remainingSteps: [fill],
      },
    });
    const running = client.call("session.run", { id: sessionId });
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(300, WEAVE_IDLE_MS / 2)));
    const mid = await inputValue(debugPort);
    expect(mid).toBe(OPERATOR);
    expect(mid).not.toContain(AGENT);
    await running;
  });

  it("when you pause, agent resumes from a fresh snapshot and acts", async () => {
    const client = new TytoClient({ url: hostUrl, token: hostToken });
    const url = `${fixtures.url}/search.html`;
    await client.call("operator.grantOrigin", { origin });
    await client.call("page.goto", { url });
    await waitForPageUrl(debugPort, "/search.html");
    await typeAsOperator(debugPort, OPERATOR);
    expect(await inputValue(debugPort)).toBe(OPERATOR);

    const sessionId = `weave-resume-${Date.now()}`;
    await client.call("session.save", {
      session: {
        id: sessionId,
        goal: "submit search",
        messages: [{ role: "user", content: "submit search" }],
        plan: null,
        recipes: [],
        answers: [],
        lastUrl: url,
        allowlist: [origin],
        model: { id: "scripted-model", baseUrl: model.baseUrl },
        vaultHandles: {},
        remainingSteps: [{ op: "click", role: "button", name: "Search" }],
      },
    });
    await client.call("session.run", { id: sessionId });
    await waitForPageUrl(debugPort, "/result.html");
  });
});

type CdpClient = {
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown>;
  disconnect(): void;
};

async function withPageSession<T>(port: number, fn: (cdp: CdpClient, sid: string) => Promise<T>): Promise<T> {
  const cdp = await connectCdp(new URL(`http://127.0.0.1:${port}`), openLoopbackWebSocket);
  try {
    const { targetInfos } = (await cdp.send("Target.getTargets", {})) as {
      targetInfos: Array<{ type: string; url: string; targetId: string }>;
    };
    const page =
      targetInfos.find((t) => t.type === "page" && t.url.includes("/search.html")) ??
      targetInfos.find((t) => t.type === "page" && t.url.startsWith("http"));
    if (!page) throw new Error("no page target");
    const attached = (await cdp.send("Target.attachToTarget", {
      targetId: page.targetId,
      flatten: true,
    })) as { sessionId?: string };
    if (!attached.sessionId) throw new Error("attachToTarget missing sessionId");
    return await fn(cdp, attached.sessionId);
  } finally {
    cdp.disconnect();
  }
}

async function waitForPageUrl(port: number, needle: string): Promise<void> {
  const cdp = await connectCdp(new URL(`http://127.0.0.1:${port}`), openLoopbackWebSocket);
  try {
    for (let i = 0; i < 40; i++) {
      const { targetInfos } = (await cdp.send("Target.getTargets", {})) as {
        targetInfos: Array<{ type: string; url: string }>;
      };
      if (targetInfos.some((t) => t.type === "page" && t.url.includes(needle))) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`page url never included ${needle}`);
  } finally {
    cdp.disconnect();
  }
}

async function typeAsOperator(port: number, text: string): Promise<void> {
  await withPageSession(port, async (cdp, sid) => {
    await cdp.send("Runtime.enable", {}, sid).catch(() => undefined);
    await cdp.send(
      "Runtime.evaluate",
      { expression: "document.getElementById('q') && document.getElementById('q').focus()", returnByValue: true },
      sid,
    );
    await cdp.send("Input.insertText", { text }, sid);
    // Trusted key so weave occupancy yields; Shift does not change the value.
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Shift" }, sid);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Shift" }, sid);
  });
}

async function queryBoxStep(
  client: TytoClient,
  origin: string,
  text: string,
): Promise<{ op: "fill"; role: string; name: string; text: string }> {
  const snap = (await client.call("page.snapshot", {
    tabId: "t",
    frameId: "main",
    origin,
  })) as { recipes: Array<{ role: string; name: string }> };
  const box =
    snap.recipes.find((r) => r.role === "searchbox") ??
    snap.recipes.find((r) => r.role === "textbox") ??
    snap.recipes.find((r) => /query/i.test(r.name));
  if (!box) throw new Error(`no query box in recipes ${JSON.stringify(snap.recipes)}`);
  return { op: "fill", role: box.role, name: box.name, text };
}

async function inputValue(port: number): Promise<string> {
  return withPageSession(port, async (cdp, sid) => {
    await cdp.send("Runtime.enable", {}, sid).catch(() => undefined);
    const evaled = (await cdp.send(
      "Runtime.evaluate",
      { expression: "document.getElementById('q') ? document.getElementById('q').value : ''", returnByValue: true },
      sid,
    )) as { result?: { value?: unknown } };
    return String(evaled.result?.value ?? "");
  });
}
