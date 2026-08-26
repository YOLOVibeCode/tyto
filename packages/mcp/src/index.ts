import { PERCH_SAFE_METHODS } from "@tyto/protocol";

export type McpToolOpts = {
  rawCdp?: boolean;
};

export function toolNames(opts?: McpToolOpts): readonly string[] {
  if (opts?.rawCdp) return [...PERCH_SAFE_METHODS, "cdp_raw"];
  return PERCH_SAFE_METHODS;
}

export async function readSessionResource(
  uri: string,
  load: (id: string) => Promise<unknown>,
): Promise<unknown> {
  const prefix = "tyto://session/";
  if (!uri.startsWith(prefix)) throw new Error("unsupported resource");
  const id = uri.slice(prefix.length);
  if (!id) throw new Error("session id required");
  const doc = await load(id);
  if (doc == null) throw new Error("session not found");
  return doc;
}

/** Tear down the MCP view. The session file is owned by the host, not this adapter. */
export async function disconnect(): Promise<void> {}
