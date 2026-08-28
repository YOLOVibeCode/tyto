/**
 * Side panel service-worker helpers.
 *
 * Panel UI → runtime.sendMessage → SW calls handlePanelMessage →
 *   fetches host JSON-RPC with Bearer token from chrome.storage.session.
 *
 * No window.tyto. No CDP from the page. Token never in panel DOM.
 */

const DEFAULT_PORT = "7420";

/**
 * @param {unknown} msg  Message from the panel.
 * @param {{ storage: { get(keys: string[]): Promise<Record<string,string>> }, fetch: typeof fetch }} deps
 * @returns {Promise<unknown>}
 */
export async function handlePanelMessage(msg, deps) {
  if (!msg || typeof msg !== "object") return { ignored: true };
  const m = /** @type {Record<string, unknown>} */ (msg);
  if (m.type === "fromPage") return { ignored: true };
  if (m.type !== "rpc") return { ignored: true };

  const stored = await deps.storage.get(["hostToken", "hostPort"]);
  const token = stored["hostToken"] ?? "";
  const port = stored["hostPort"] ?? DEFAULT_PORT;
  const url = `http://127.0.0.1:${port}/`;

  const response = await deps.fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: String(m.id ?? crypto.randomUUID()),
      method: m.method,
      params: m.params ?? {},
    }),
  });

  const body = /** @type {unknown} */ (await response.json());
  const b = /** @type {Record<string, unknown>} */ (body);
  if (b.error) throw new Error(String(/** @type {Record<string,unknown>} */ (b.error).message ?? b.error));
  return b.result;
}

/**
 * Scope the side panel to a specific tab.
 * @param {{ setOptions(opts: Record<string,unknown>): Promise<void> }} sidePanel
 * @param {number} tabId
 */
export async function scopeThisTab(sidePanel, tabId) {
  await sidePanel.setOptions({ tabId });
}

/**
 * Scope the side panel to all tabs (global panel).
 * @param {{ setOptions(opts: Record<string,unknown>): Promise<void> }} sidePanel
 */
export async function scopeAllTabs(sidePanel) {
  await sidePanel.setOptions({});
}
