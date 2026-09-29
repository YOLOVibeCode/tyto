/**
 * JSON-RPC 2.0 surface, two scopes.
 * safe  (Perch, MCP): PERCH_SAFE_METHODS — no RawCdp, no CredentialStorePort, no secret values.
 * power (tyto CLI):   PERCH_SAFE_METHODS ∪ POWER_METHODS — raw CDP, cookies, storage; masked unless reveal.
 */

export const PERCH_SAFE_METHODS = [
  "session.open",
  "session.save",
  "session.list",
  "session.run",
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

/** Owner-only methods (power token). Disjoint from PERCH_SAFE_METHODS. Slice 18. */
export const POWER_METHODS = [
  "cdp.send",
  "cookies.list",
  "cookies.set",
  "cookies.delete",
  "cookies.clear",
  "storage.read",
  "network.body",
  "tabs.list",
  "tabs.new",
  "tabs.close",
  "tabs.focus",
] as const;

export type PowerMethod = (typeof POWER_METHODS)[number];

export type TokenScope = "safe" | "power";

const POWER_SET = new Set<string>(POWER_METHODS);

export function isPowerMethod(method: string): method is PowerMethod {
  return POWER_SET.has(method);
}

export function methodAllowed(scope: TokenScope, method: string): boolean {
  switch (scope) {
    case "safe":
      return isPerchSafeMethod(method);
    case "power":
      return isPerchSafeMethod(method) || isPowerMethod(method);
    default: {
      const never: never = scope;
      return never;
    }
  }
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
