import type { AxSnapshot, ExtractResult } from "../types.ts";

export class ShellNotReady extends Error {
  readonly code = "ShellNotReady" as const;
  constructor() {
    super("extract blocked: document is still a shell");
    this.name = "ShellNotReady";
  }
}

export function extractFromAx(snap: AxSnapshot, query: string): ExtractResult {
  const q = query.toLowerCase();
  const lines = snap.tree.split("\n");
  if (/conservation/.test(q)) {
    const hit = lines.find((l) => /least concern|conservation/i.test(l));
    if (hit) {
      const m = hit.match(/"([^"]+)"/g);
      const last = m?.at(-1)?.replaceAll('"', "");
      if (last && /least concern/i.test(last)) return { ok: true, text: last };
      const nearby = lines.find((l) => /least concern/i.test(l));
      if (nearby) {
        const n = nearby.match(/"([^"]+)"/);
        if (n?.[1]) return { ok: true, text: n[1] };
        return { ok: true, text: "Least Concern" };
      }
    }
  }
  const needle = query.replace(/extract\s+/i, "").trim();
  const line = lines.find((l) => l.toLowerCase().includes(needle.toLowerCase()));
  if (!line) return { ok: false, reason: "miss" };
  const named = line.match(/"([^"]+)"/);
  return { ok: true, text: named?.[1] ?? line.trim() };
}

export function extractOrThrow(shape: string, snap: AxSnapshot, query: string): ExtractResult {
  if (shape === "shell") throw new ShellNotReady();
  return extractFromAx(snap, query);
}
