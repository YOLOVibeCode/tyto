import type { Redactor } from "../ports/redactor.ts";
import { isApi, isNoise, originOf, shortUrl } from "./net.ts";
import type { Brief, BriefCookie, BriefInput, CookieEntry } from "./types.ts";

const MAX_ELEMENTS = 40;
const MAX_ISSUES_PER_KIND = 5;

function lifetime(c: CookieEntry, nowMs: number): string {
  if (c.session === true || c.expires === undefined || c.expires <= 0) return "session";
  return `${Math.max(0, Math.round((c.expires - nowMs / 1000) / 86_400))}d`;
}

/** Everything about the current page, scoped by `mark`, secrets masked. */
export function assembleBrief(input: BriefInput, redactor: Redactor): Brief {
  const origin = originOf(input.url);
  const requests = input.requests.slice(input.mark.requests).filter((r) => !isNoise(r));
  const errors = input.errors.slice(input.mark.errors);
  const consoleEntries = input.console.slice(input.mark.console);

  const failed = requests.filter((r) => (r.status ?? 0) >= 400);
  const issues: string[] = [];
  for (const r of failed.slice(0, MAX_ISSUES_PER_KIND)) {
    let line = `network ${r.status ?? "?"} ${r.method} ${shortUrl(r.url, origin)} (${r.resourceType ?? "?"})`;
    const body = input.bodies[r.requestId];
    if (body && isApi(r)) line += ` → ${redactor.safe(body.replace(/\s+/g, " ")).slice(0, 160)}`;
    issues.push(line);
  }
  for (const e of errors.slice(0, MAX_ISSUES_PER_KIND)) issues.push(`uncaught ${redactor.safe(e.text).slice(0, 300)}`);
  for (const m of consoleEntries) {
    if (m.type === "error" || m.type === "warning" || m.type === "assert") issues.push(`console.${m.type} '${redactor.safe(m.text).slice(0, 200)}'`);
  }

  const byType: Record<string, number> = {};
  for (const r of requests) {
    const t = (r.resourceType ?? "other").toLowerCase();
    byType[t] = (byType[t] ?? 0) + 1;
  }

  const cookies: BriefCookie[] = input.cookies.map((c) => ({
    name: c.name,
    domain: c.domain ?? "",
    httpOnly: c.httpOnly === true,
    lifetime: lifetime(c, input.now),
  }));

  const elements = input.snapshot.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() !== "");

  return {
    url: input.url,
    title: input.title,
    status: input.page.status,
    framework: input.page.framework,
    timing: { dclMs: input.page.dclMs, loadMs: input.page.loadMs },
    forms: input.page.forms,
    iframes: input.page.iframes,
    issues,
    network: {
      total: requests.length,
      byType,
      failed: failed.length,
      api: requests.filter(isApi).slice(0, 15).map((r) => `${r.method} ${shortUrl(r.url, origin)} → ${r.status ?? "pending"}`),
    },
    cookies,
    storage: { local: Object.keys(input.localStorage).length, session: Object.keys(input.sessionStorage).length },
    outline: input.page.headings,
    elements: elements.slice(0, MAX_ELEMENTS),
    elementsTotal: elements.length,
    text: redactor.safe(input.page.text),
  };
}
