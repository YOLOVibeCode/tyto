import type { JsonRpcRequest, JsonRpcResponse } from "@tyto/protocol";

export class RpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "RpcError";
    this.code = code;
  }
}

export class TytoClient {
  constructor(private readonly opts: { url: string; token: string }) {}

  async call(method: string, params?: unknown, signal?: AbortSignal): Promise<unknown> {
    const payload: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method,
    };
    if (params !== undefined) payload.params = params;

    const res = await fetch(this.opts.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.opts.token}`,
      },
      body: JSON.stringify(payload),
      ...(signal ? { signal } : {}),
    });

    const body = (await res.json()) as JsonRpcResponse;
    if ("error" in body) throw new RpcError(body.error.code, body.error.message);
    return body.result;
  }
}
