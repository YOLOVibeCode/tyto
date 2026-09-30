import { isNoise, originOf, shortUrl } from "./net.ts";
import type { ConsoleEntry, ErrorEntry, RequestEntry } from "./types.ts";

export type Before = { url: string; console: number; errors: number; requests: number };
export type AfterState = { url: string; console: ConsoleEntry[]; errors: ErrorEntry[]; requests: RequestEntry[] };

/** What changed since an action: navigation, new requests, uncaught errors, console output. */
export function afterAction(before: Before, after: AfterState): string {
  const origin = originOf(after.url);
  const lines: string[] = [];
  if (after.url !== before.url) lines.push(`  → now at ${after.url}`);
  for (const r of after.requests.slice(before.requests)) {
    if (!isNoise(r)) lines.push(`  net ${r.method} ${shortUrl(r.url, origin)} → ${r.status ?? "pending"}`);
  }
  for (const e of after.errors.slice(before.errors)) lines.push(`  ✗ uncaught ${e.text.slice(0, 300)}`);
  for (const m of after.console.slice(before.console)) lines.push(`  console.${m.type} '${m.text.slice(0, 200)}'`);
  return `AFTER\n${lines.length ? lines.join("\n") : "  no navigation, requests, or console output"}`;
}
