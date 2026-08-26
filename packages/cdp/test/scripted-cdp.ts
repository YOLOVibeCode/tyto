export type CdpCall = {
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
};

export class ScriptedCdp {
  readonly calls: CdpCall[] = [];
  readonly handlers = new Map<string, (params: unknown, sessionId?: string) => unknown>();

  async send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<unknown> {
    const rec: CdpCall = { method };
    if (params !== undefined) rec.params = params;
    if (sessionId !== undefined) rec.sessionId = sessionId;
    this.calls.push(rec);
    const keyed = sessionId ? `${sessionId}:${method}` : method;
    const handler = this.handlers.get(keyed) ?? this.handlers.get(method);
    if (handler) return handler(params, sessionId);
    if (method === "DOM.getBoxModel") {
      return { model: { content: [0, 0, 20, 0, 20, 20, 0, 20] } };
    }
    if (
      method === "Input.dispatchMouseEvent" ||
      method === "DOM.scrollIntoViewIfNeeded" ||
      method === "Target.setAutoAttach"
    ) {
      return {};
    }
    if (method === "Accessibility.getFullAXTree") return { nodes: [] };
    throw new Error(`unscripted CDP method ${method}`);
  }
}
