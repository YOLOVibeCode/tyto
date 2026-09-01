/* Tyto background service worker.
 * - ATTACH mode: native messaging → debugger proxy.
 * - Side panel: opens on action click; proxies JSON-RPC to loopback host with Bearer token.
 *
 * Page JS is data, not commands. No exposed global API.
 */
import { onPageMessage, seedHostAuth, handleNativeMessage, NATIVE_HOST_NAME, autoAttachDebugger } from "./native-protocol.js";
import { handlePanelMessage, scopeThisTab, scopeAllTabs } from "./sidepanel-sw.js";

/* ── side panel opens on toolbar click ─────────────────────────── */
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

function nativeCtx() {
  return {
    senderId: chrome.runtime.id,
    expectedExtensionId: chrome.runtime.id,
    sendCdp: async (method, params) => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("no tab");
      return chrome.debugger.sendCommand({ tabId: tab.id }, method, params ?? {});
    },
    attachDebugger: (tabId) => autoAttachDebugger(chrome, tabId),
    detachDebugger: async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      try {
        await chrome.debugger.detach({ tabId: tab.id });
      } catch {
        /* already detached */
      }
    },
  };
}

try {
  const nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
  nativePort.onMessage.addListener((msg) => {
    if (msg && msg.type === "hello") {
      const token = String(msg.token ?? "");
      const hostPort = String(msg.port ?? "");
      if (token.length >= 16) {
        chrome.storage.session.set({ hostToken: token, hostPort });
      }
      return;
    }
    void handleNativeMessage(msg, nativeCtx()).then((result) => {
      try {
        nativePort.postMessage(result);
      } catch {
        /* disconnected */
      }
    });
  });
  nativePort.postMessage({ type: "hello" });
} catch {
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
}

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
