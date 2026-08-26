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

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
};

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: string | number; result: unknown }
  | { jsonrpc: "2.0"; id: string | number; error: { code: number; message: string } };
