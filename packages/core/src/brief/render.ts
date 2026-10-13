import type { Brief } from "./types.ts";

/** Compact text brief for any model. Ends with an approximate token count. */
export function renderBrief(b: Brief): string {
  const out: string[] = [];
  out.push(`PAGE     ${b.title} — ${b.url}  [${b.status ?? "?"}, DOMContentLoaded ${b.timing.dclMs}ms, load ${b.timing.loadMs}ms]`);
  out.push(`APP      ${b.framework.join(", ") || "no framework detected"} · ${b.forms} form(s) · ${b.iframes} iframe(s)`);
  out.push(`ISSUES   ${b.issues.length}${b.issues.length ? "" : " — none"}`);
  for (const i of b.issues) out.push(`  ✗ ${i}`);
  const kinds = Object.entries(b.network.byType)
    .sort(([a], [z]) => a.localeCompare(z))
    .map(([k, v]) => `${v} ${k}`)
    .join(", ");
  out.push(`NETWORK  ${b.network.total} requests${kinds ? ` (${kinds})` : ""}, ${b.network.failed} failed`);
  for (const a of b.network.api.slice(0, 10)) out.push(`  api ${a}`);
  const cookies = b.cookies.map((c) => `${c.name}(${c.httpOnly ? "httpOnly " : ""}${c.lifetime})`).join(", ") || "none";
  out.push(`STATE    cookies: ${cookies} · localStorage: ${b.storage.local} keys · sessionStorage: ${b.storage.session} keys  (values masked)`);
  if (b.outline.length) out.push(`OUTLINE  ${b.outline.join(" | ")}`);
  out.push(`ELEMENTS (${b.elementsTotal} interactive; use the @eN refs with tyto click/fill)`);
  for (const e of b.elements) out.push(`  ${e}`);
  if (b.elementsTotal > b.elements.length) out.push(`  … ${b.elementsTotal - b.elements.length} more (agent-browser snapshot -i)`);
  if (b.text) out.push(`TEXT     ${b.text}`);
  const text = out.join("\n");
  return `${text}\n(${Math.round(text.length / 4)} tokens)`;
}
