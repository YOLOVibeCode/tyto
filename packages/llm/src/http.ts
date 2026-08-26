export function joinPath(base: URL, path: string): URL {
  const root = base.href.endsWith("/") ? base.href : `${base.href}/`;
  return new URL(path.replace(/^\//, ""), root);
}

export function asRecord(v: unknown): Record<string, unknown> | undefined {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return undefined;
}

export async function requestJson(
  url: URL,
  init: { method: string; headers: Record<string, string>; body?: string },
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, {
    method: init.method,
    headers: init.headers,
    ...(init.body !== undefined ? { body: init.body } : {}),
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status === 404) {
    await res.arrayBuffer();
    return { status: 404, json: null };
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`model adapter: HTTP ${res.status}`);
  if (!text) return { status: res.status, json: null };
  try {
    return { status: res.status, json: JSON.parse(text) as unknown };
  } catch {
    throw new Error("model adapter: invalid json");
  }
}

export function bearerHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  return headers;
}
