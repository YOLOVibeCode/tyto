/* Tyto background service worker.
 * - ATTACH mode: native messaging → debugger proxy.
 * - Side panel: opens on action click; proxies JSON-RPC to loopback host with Bearer token.
 *
 * Page JS is data, not commands. No exposed global API.
 */
import { onPageMessage, seedHostAuth } from "./native-protocol.js";
import { handlePanelMessage, scopeThisTab, scopeAllTabs } from "./sidepanel-sw.js";

/* ── side panel opens on toolbar click ─────────────────────────── */
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

seedHostAuth({
  sendNativeMessage: (host, msg) =>
    new Promise((resolve, reject) => {
      chrome.runtime.sendNativeMessage(host, msg, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(resp);
      });
    }),
  storage: chrome.storage.session,
}).catch(() => {});

/* ── ATTACH protocol (native messaging / debugger) ─────────────── */
chrome.runtime.onMessage.addListener(onPageMessage);

/* ── Panel → SW → host RPC proxy ──────────────────────────────── */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "rpc") return false;
  handlePanelMessage(msg, {
    storage: chrome.storage.session,
    fetch: globalThis.fetch.bind(globalThis),
  })
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => sendResponse({ ok: false, error: String(err && err.message ? err.message : err) }));
  return true; /* async */
});

/* ── Scope toggle messages from panel ──────────────────────────── */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return false;
  if (msg.type === "scope:tab") {
    scopeThisTab(chrome.sidePanel, Number(msg.tabId))
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (msg.type === "scope:all") {
    scopeAllTabs(chrome.sidePanel)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  return false;
});
