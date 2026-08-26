/**
 * ATTACH native-messaging protocol. Page JS cannot command Tyto.
 * @typedef {{ senderId: string, expectedExtensionId: string, sendCdp: (method: string, params?: unknown) => Promise<unknown> }} NativeCtx
 */

export function onPageMessage(_message, _sender) {
  return false;
}

export async function handleNativeMessage(msg, ctx) {
  if (!msg || typeof msg !== "object") return { error: "invalid" };
  if (msg.type === "fromPage") return { ignored: true };
  if (msg.type !== "cdp") return { error: "unsupported" };
  if (ctx.senderId !== ctx.expectedExtensionId) return { error: "rejected origin" };
  if (typeof msg.method !== "string") return { error: "invalid" };
  return ctx.sendCdp(msg.method, msg.params);
}

export async function autoAttachDebugger(chrome, tabId) {
  await chrome.debugger.attach({ tabId }, "1.3");
}
