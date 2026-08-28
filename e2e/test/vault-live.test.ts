/**
 * Slice 9b live — identity vault cookie round-trip + redaction grep.
 * Requires: TYTO_E2E=1 TYTO_LIVE=1
 *
 * Capture is host-owned (not a Perch-safe RPC). This test composes
 * CdpCredentialStore + MemoryIdentityVault against a second CDP connection,
 * the same way the host kernel would, without exposing cookies to Perch/MCP.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CdpCredentialStore, connectCdp, openLoopbackWebSocket } from "@tyto/cdp";
import { OriginAllowlist, parseSession } from "@tyto/core";
import { bootLive, freeLoopbackPort } from "@tyto/host";
import { MemoryIdentityVault, MemorySecretStore } from "@tyto/secrets";
import { TytoClient } from "@tyto/sdk";
import {
  startFixtureServer,
  VAULT_SESSION_COOKIE,
  VAULT_SESSION_VALUE,
  type FixtureServer,
} from "../src/fixture-server.ts";
import { e2eLauncher, ensureLiveSpawn, waitUntilCdpGone } from "../src/live-chrome.ts";
import { startScriptedModel, type ScriptedModelServer } from "../src/scripted-model.ts";

const LIVE = process.env.TYTO_E2E === "1" && process.env.TYTO_LIVE === "1";

describe.skipIf(!LIVE)("identity vault — live cookie session round-trip", () => {
  let fixtures: FixtureServer;
  let model: ScriptedModelServer;
  let hostUrl: string;
  let hostToken: string;
  let debugPort: number;
  let profileDir: string;
  let emptyProfileDir: string;
  let sessionDir: string;
  let closeHost: (() => Promise<void>) | undefined;
  let origin: string;
  let vault: MemoryIdentityVault;
  let handle = "";

  beforeAll(async () => {
    [fixtures, model, debugPort] = await Promise.all([
      startFixtureServer(),
      startScriptedModel(),
      freeLoopbackPort(),
    ]);
    profileDir = await mkdtemp(join(tmpdir(), "tyto-vault-profile-"));
    emptyProfileDir = await mkdtemp(join(tmpdir(), "tyto-vault-empty-"));
    sessionDir = await mkdtemp(join(tmpdir(), "tyto-vault-sessions-"));
    hostToken = "e2e-vault-token-secure";
    origin = fixtures.url;

    ensureLiveSpawn();
    const env: Record<string, string> = {
      TYTO_HOST_TOKEN: hostToken,
      TYTO_LIVE: "1",
      TYTO_PORT: "0",
      TYTO_BASE_URL: model.baseUrl,
      TYTO_MODEL: "scripted-model",
      TYTO_DEBUG_PORT: String(debugPort),
      TYTO_PROFILE: profileDir,
      TYTO_SESSION_DIR: sessionDir,
    };
    const server = await bootLive(env, { launcher: e2eLauncher() });
    hostUrl = server.url;
    closeHost = () => server.close();
  });

  afterAll(async () => {
    await closeHost?.();
    await fixtures.close();
    await model.close();
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    await rm(emptyProfileDir, { recursive: true, force: true }).catch(() => {});
    await rm(sessionDir, { recursive: true, force: true }).catch(() => {});
  });

  it("capture, quit Chrome, relaunch empty profile, restore: account still authenticated", async () => {
    const client = new TytoClient({ url: hostUrl, token: hostToken });
    await client.call("operator.grantOrigin", { origin });
    await client.call("page.goto", { url: `${fixtures.url}/session/grant` });
    await waitForPageUrl(debugPort, "/account");

    const allow = new OriginAllowlist();
    allow.grant(origin);
    const { cdp, store } = await openCredentialCdp(debugPort);
    try {
      vault = new MemoryIdentityVault(new MemorySecretStore(), allow, store);
      handle = await vault.capture(origin);
    } finally {
      cdp.disconnect();
    }

    expect(handle.startsWith("vault_")).toBe(true);
    expect(vault.ciphertext(origin)).toBeTruthy();
    expect(vault.ciphertext(origin)).not.toContain(VAULT_SESSION_VALUE);

    await client.call("browser.disconnect");
    await waitUntilCdpGone(debugPort);

    await client.call("browser.launch", {
      browser: "chrome",
      userDataDir: emptyProfileDir,
      port: debugPort,
    });

    await client.call("page.goto", { url: `${fixtures.url}/account` });
    await waitForPageUrl(debugPort, "/account");
    const denied = await pageInnerText(debugPort);
    expect(denied).toMatch(/please log in/i);
    expect(denied).not.toMatch(/signed in/i);

    const restored = await openCredentialCdp(debugPort);
    try {
      vault.bindCredentialStore(restored.store);
      await vault.restore(origin);
    } finally {
      restored.cdp.disconnect();
    }

    await client.call("page.goto", { url: `${fixtures.url}/account` });
    await waitForPageUrl(debugPort, "/account");
    const welcome = await pageInnerText(debugPort);
    expect(welcome).toMatch(/signed in/i);
    expect(welcome).not.toContain(VAULT_SESSION_VALUE);
  });

  it("redaction: session file, tape, model prompt, and ciphertext contain no cookie value", async () => {
    const client = new TytoClient({ url: hostUrl, token: hostToken });
    const sessionId = `vault-redact-${Date.now()}`;

    await client.call("models.complete", {
      system: "plan",
      user: `Cookie: ${VAULT_SESSION_COOKIE}=${VAULT_SESSION_VALUE}`,
    });
    const promptBlob = model.prompts.join("\n");
    expect(promptBlob).not.toContain(VAULT_SESSION_VALUE);

    await client.call("session.save", {
      session: {
        id: sessionId,
        goal: "confirm signed-in state without leaking the session cookie",
        messages: [{ role: "user", content: "confirm signed-in state" }],
        plan: null,
        recipes: [],
        answers: [],
        lastUrl: `${fixtures.url}/account`,
        allowlist: [origin],
        model: { id: "scripted-model", baseUrl: model.baseUrl },
        vaultHandles: { [origin]: handle || "vault_1" },
        remainingSteps: [],
      },
    });
    await client.call("session.run", { id: sessionId });

    const sessionFile = join(sessionDir, `${sessionId}.json`);
    const raw = await readFile(sessionFile, "utf8");
    expect(raw).not.toContain(VAULT_SESSION_VALUE);
    expect(raw).not.toContain(`${VAULT_SESSION_COOKIE}=`);
    const session = parseSession(raw);
    expect(session?.vaultHandles[origin] ?? session?.vaultHandles[`${origin}/`]).toBeTruthy();

    const tape = (await client.call("tape.recent", { n: 50 })) as Array<{ detail: string }>;
    const tapeBlob = tape.map((e) => e.detail).join("\n");
    expect(tapeBlob).not.toContain(VAULT_SESSION_VALUE);

    const ct = vault?.ciphertext(origin) ?? "";
    expect(ct).not.toContain(VAULT_SESSION_VALUE);
  });
});

type CdpClient = {
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown>;
  disconnect(): void;
};

async function openCredentialCdp(port: number): Promise<{ cdp: CdpClient; store: CdpCredentialStore }> {
  const cdp = await connectCdp(new URL(`http://127.0.0.1:${port}`), openLoopbackWebSocket);
  await cdp.send("Network.enable", {}).catch(() => undefined);
  await cdp.send("DOMStorage.enable", {}).catch(() => undefined);
  return { cdp, store: new CdpCredentialStore(cdp) };
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

async function pageInnerText(port: number): Promise<string> {
  const cdp = await connectCdp(new URL(`http://127.0.0.1:${port}`), openLoopbackWebSocket);
  try {
    const { targetInfos } = (await cdp.send("Target.getTargets", {})) as {
      targetInfos: Array<{ type: string; url: string; targetId: string }>;
    };
    const page =
      targetInfos.find((t) => t.type === "page" && t.url.includes("/account")) ??
      targetInfos.find((t) => t.type === "page" && t.url.startsWith("http"));
    if (!page) throw new Error("no page target");
    const attached = (await cdp.send("Target.attachToTarget", {
      targetId: page.targetId,
      flatten: true,
    })) as { sessionId?: string };
    if (!attached.sessionId) throw new Error("attachToTarget missing sessionId");
    await cdp.send("Runtime.enable", {}, attached.sessionId).catch(() => undefined);
    const evaled = (await cdp.send(
      "Runtime.evaluate",
      { expression: "document.body.innerText", returnByValue: true },
      attached.sessionId,
    )) as { result?: { value?: unknown } };
    return String(evaled.result?.value ?? "");
  } finally {
    cdp.disconnect();
  }
}
