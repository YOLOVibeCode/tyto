/**
 * Tier 3 — Playwright extension test.
 * Requires: TYTO_E2E=1
 * Run with: npm run test:e2e
 *
 * Loads the unpacked extension into Playwright Chromium (headless:false, required for extensions).
 * Seeds hostToken/hostPort into chrome.storage.session via the service worker.
 * Uses ctx.route() to intercept all extension→host HTTP traffic with canned responses.
 * Opens sidepanel.html as a tab and drives the real DOM.
 *
 * Playwright's role: operator's finger on the side panel DOM only.
 * Token never appears in panel DOM.
 */
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { Route } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type BrowserContext } from "@playwright/test";

const LIVE = process.env.TYTO_E2E === "1";
const EXTENSION_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../extension");

/** A fake host port that we intercept with ctx.route(); nothing actually listens here. */
const MOCK_PORT = 17420;
const MOCK_TOKEN = "ext-test-token-secure-00000000";

describe.skipIf(!LIVE)("extension side panel — Playwright-driven DOM test", () => {
  let ctx: BrowserContext;
  let extensionId: string;
  let ctxUserDataDir: string;
  let grantOriginCalled = false;

  // Simulated session state for session.open after session.run
  let sessionRan = false;

  type MockBody = { id?: unknown; method?: string; params?: Record<string, unknown> };

  async function mockHost(route: Route): Promise<void> {
    let body: MockBody = {};
    try {
      body = JSON.parse(route.request().postData() ?? "{}") as MockBody;
    } catch { /* ignore */ }

    const auth = route.request().headers()["authorization"] ?? "";
    if (!auth.includes(MOCK_TOKEN)) {
      await route.fulfill({ status: 401, body: JSON.stringify({ error: "unauthorized" }) });
      return;
    }

    const method = body.method ?? "";
    let result: unknown = { ok: true };

    if (method === "models.list") {
      result = { ids: ["scripted-model"] };
    } else if (method === "session.save") {
      result = { ok: true };
    } else if (method === "session.run") {
      sessionRan = true;
      result = { ok: true };
    } else if (method === "session.open") {
      if (sessionRan) {
        result = {
          id: "test-session",
          goal: "extract the result",
          messages: [
            { role: "user", content: "extract the result" },
            { role: "assistant", content: "Done — extracted the answer." },
          ],
          plan: null,
          recipes: [],
          answers: [],
          lastUrl: null,
          allowlist: [],
          model: { id: "scripted-model", baseUrl: "" },
          vaultHandles: {},
          remainingSteps: [],
        };
      } else {
        result = null;
      }
    } else if (method === "operator.grantOrigin") {
      grantOriginCalled = true;
      result = { ok: true };
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jsonrpc: "2.0", id: body.id, result }),
    });
  }

  beforeAll(async () => {
    ctxUserDataDir = await mkdtemp(join(tmpdir(), "tyto-ext-profile-"));
    // headless: false — Playwright Chromium requires a display to load extensions.
    // channel: "chrome" does NOT expose service workers via Playwright's CDP; use default Chromium.
    ctx = await chromium.launchPersistentContext(ctxUserDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_DIR}`,
        `--load-extension=${EXTENSION_DIR}`,
      ],
    });

    // Intercept all extension→host HTTP traffic (the SW fetches to MOCK_PORT)
    await ctx.route(`http://127.0.0.1:${MOCK_PORT}/`, mockHost);

    // Poll for the service worker — it registers asynchronously on browser start
    let worker;
    for (let i = 0; i < 30; i++) {
      const workers = ctx.serviceWorkers();
      if (workers.length > 0) { worker = workers[0]; break; }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!worker) throw new Error("extension service worker not found after 15s");

    const swUrl = worker.url();
    const idMatch = swUrl.match(/chrome-extension:\/\/([a-z]+)\//);
    if (!idMatch?.[1]) throw new Error("could not extract extension ID from: " + swUrl);
    extensionId = idMatch[1];

    // Seed token + port into chrome.storage.session via the service worker
    type SWGlobal = { chrome: { storage: { session: { set(x: Record<string, unknown>): Promise<void> } } } };
    await worker.evaluate(
      async ({ token, port }: { token: string; port: number }) => {
        await (globalThis as unknown as SWGlobal).chrome.storage.session.set({
          hostToken: token,
          hostPort: String(port),
        });
      },
      { token: MOCK_TOKEN, port: MOCK_PORT },
    );
  });

  afterAll(async () => {
    await ctx?.close();
    await rm(ctxUserDataDir, { recursive: true, force: true }).catch(() => {});
  });

  it("model dropdown populates from host catalog", async () => {
    const panelPage = await ctx.newPage();
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panelPage.waitForFunction(
      () => {
        const sel = document.getElementById("model") as HTMLSelectElement | null;
        return sel !== null && sel.options.length > 0 && sel.options[0]?.value !== "" &&
               sel.innerHTML !== '<option value="">loading…</option>';
      },
      undefined,
      { timeout: 15_000 },
    );
    const values = await panelPage.locator("#model option").allTextContents();
    expect(values).toContain("scripted-model");
    await panelPage.close();
  });

  it("send a goal → assistant reply appears in transcript", async () => {
    sessionRan = false;
    const panelPage = await ctx.newPage();
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    // Wait for panel to be ready (models loaded)
    await panelPage.waitForFunction(
      () => {
        const sel = document.getElementById("model") as HTMLSelectElement | null;
        return sel !== null && sel.options.length > 0 && sel.options[0]?.value !== "";
      },
      undefined,
      { timeout: 15_000 },
    );

    await panelPage.fill("#compose", "extract the result");
    await panelPage.click("#send");

    // Wait for assistant reply to appear in the transcript
    await panelPage.waitForSelector(".msg.assistant .bubble", { timeout: 15_000 });
    const text = await panelPage.locator(".msg.assistant .bubble").first().textContent();
    expect(text).toBeTruthy();
    await panelPage.close();
  });

  it("token does not appear in panel DOM at any point", async () => {
    const panelPage = await ctx.newPage();
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panelPage.waitForSelector("#send");
    const html = await panelPage.content();
    expect(html).not.toContain(MOCK_TOKEN);
    await panelPage.close();
  });

  it("page origin not auto-granted before user sends a goal", async () => {
    grantOriginCalled = false;
    const panelPage = await ctx.newPage();
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panelPage.waitForSelector("#send");
    // Allow loadModels() to settle — grantOrigin must NOT be called during panel init
    await panelPage.waitForFunction(
      () => {
        const sel = document.getElementById("model") as HTMLSelectElement | null;
        return sel !== null && sel.options.length > 0;
      },
      undefined,
      { timeout: 10_000 },
    );
    expect(grantOriginCalled).toBe(false);
    await panelPage.close();
  });
});
