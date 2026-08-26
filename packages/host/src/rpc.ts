import type { IncomingMessage, ServerResponse } from "node:http";
import { RPC_ERROR, type JsonRpcId, type JsonRpcRequest } from "@tyto/protocol";

export class RpcException extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "RpcException";
  }
}

export function record(params: unknown): Record<string, unknown> {
  if (params !== null && typeof params === "object" && !Array.isArray(params)) {
    return params as Record<string, unknown>;
  }
  return {};
}

export function isJsonRpcRequest(v: unknown): v is JsonRpcRequest {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    o.jsonrpc === "2.0" &&
    typeof o.method === "string" &&
    (typeof o.id === "string" || typeof o.id === "number")
  );
}

export async function readBody(req: IncomingMessage, limit = 1_000_000): Promise<string> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    n += b.length;
    if (n > limit) throw new RpcException(RPC_ERROR.INVALID_REQUEST, "payload too large");
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function writeRpc(
  res: ServerResponse,
  status: number,
  body: { jsonrpc: "2.0"; id: JsonRpcId; result: unknown } | { jsonrpc: "2.0"; id: JsonRpcId; error: { code: number; message: string } },
): void {
  if (res.writableEnded) return;
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

export function writeUnauthorized(res: ServerResponse, id: JsonRpcId = null): void {
  writeRpc(res, 401, {
    jsonrpc: "2.0",
    id,
    error: { code: RPC_ERROR.UNAUTHORIZED, message: "unauthorized" },
  });
}
