/** JSON-RPC 2.0 surface. No RawCdp, no CredentialStorePort. */

export const PERCH_SAFE_METHODS = [
  "session.open",
  "session.save",
  "session.list",
  "profiles.list",
  "browser.launch",
  "browser.disconnect",
  "page.goto",
  "page.snapshot",
  "page.act",
  "page.waitReady",
  "page.extract",
  "frames.list",
  "frames.focus",
  "tape.recent",
  "tape.wait",
  "operator.interrupt",
  "operator.confirm",
  "operator.grantOrigin",
  "identity.status",
  "models.complete",
  "models.list",
] as const;

export type PerchSafeMethod = (typeof PERCH_SAFE_METHODS)[number];

const PERCH_SAFE_SET = new Set<string>(PERCH_SAFE_METHODS);

export function isPerchSafeMethod(method: string): method is PerchSafeMethod {
  return PERCH_SAFE_SET.has(method);
}

/** Stable JSON-RPC codes. Clients match these; never send stack traces. */
export const RPC_ERROR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  UNAUTHORIZED: -32001,
  POLICY: -32003,
} as const;

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
};

export type JsonRpcError = { code: number; message: string };

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
  | { jsonrpc: "2.0"; id: JsonRpcId; error: JsonRpcError };
