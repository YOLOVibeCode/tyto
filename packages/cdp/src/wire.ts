export type CdpWire = {
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown>;
};

export async function cdpCall(
  wire: CdpWire,
  method: string,
  params: Record<string, unknown>,
  sessionId: string | undefined,
): Promise<unknown> {
  if (sessionId !== undefined) return wire.send(method, params, sessionId);
  return wire.send(method, params);
}

export function asRecord(v: unknown): Record<string, unknown> | undefined {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return undefined;
}
