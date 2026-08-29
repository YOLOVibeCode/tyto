import { LoopbackBindPolicy } from "@tyto/core";
import { asRecord, type CdpWire } from "./wire.ts";

/** Open Perch as a new tab. Does not attach — the work tab keeps the page session. */
export async function openSteerTab(wire: CdpWire, url: URL): Promise<{ targetId: string }> {
  new LoopbackBindPolicy().assertLoopback(url.hostname);
  const created = asRecord(await wire.send("Target.createTarget", { url: url.href }));
  const targetId = created?.targetId;
  if (typeof targetId !== "string" || !targetId) {
    throw new Error("createTarget missing targetId");
  }
  return { targetId };
}
