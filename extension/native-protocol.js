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

export const NATIVE_HOST_NAME = "com.noctusoft.tyto";

/**
 * Ask the native host for loopback port + token. Token stays in session storage, never in the panel DOM.
 * @param {{ sendNativeMessage: (host: string, msg: unknown) => Promise<unknown>, storage: { set(vals: Record<string, string>): Promise<void> } }} deps
 */
export async function seedHostAuth(deps) {
  const reply = await deps.sendNativeMessage(NATIVE_HOST_NAME, { type: "hello" });
  if (!reply || typeof reply !== "object") return { ok: false };
  const r = /** @type {Record<string, unknown>} */ (reply);
  if (r.type !== "hello") return { ok: false };
  const token = String(r.token ?? "");
  const port = String(r.port ?? "");
  if (token.length < 16) return { ok: false };
  await deps.storage.set({ hostToken: token, hostPort: port });
  return { ok: true };
}
