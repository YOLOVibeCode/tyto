import { asRecord, type CdpWire } from "./wire.ts";

function pageTargetId(raw: unknown): string | undefined {
  const infos = asRecord(raw)?.targetInfos;
  if (!Array.isArray(infos)) return undefined;
  for (const item of infos) {
    const rec = asRecord(item);
    if (rec?.type === "page" && typeof rec.targetId === "string") return rec.targetId;
  }
  const first = asRecord(infos[0]);
  if (typeof first?.targetId === "string") return first.targetId;
  return undefined;
}

/** Attach a tab session. AX and Input must use this sessionId, not the browser websocket alone. */
export async function attachPageSession(wire: CdpWire): Promise<string> {
  await wire.send("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  });
  const listed = await wire.send("Target.getTargets");
  let targetId = pageTargetId(listed);
  if (!targetId) {
    const created = asRecord(await wire.send("Target.createTarget", { url: "about:blank" }));
    if (typeof created?.targetId === "string") targetId = created.targetId;
  }
  if (!targetId) throw new Error("no page target");
  const attached = asRecord(await wire.send("Target.attachToTarget", { targetId, flatten: true }));
  if (typeof attached?.sessionId !== "string" || !attached.sessionId) {
    throw new Error("attachToTarget missing sessionId");
  }
  const sid = attached.sessionId;
  await wire.send("Page.enable", {}, sid);
  await wire.send("Accessibility.enable", {}, sid);
  return sid;
}
