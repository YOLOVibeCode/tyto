import type { BatchStepResult } from "../ports/browser-runner.ts";
import type { ConsoleEntry, CookieEntry, ErrorEntry, LogCounts, PageFacts, RequestEntry } from "./types.ts";

/** Facts only the page can tell: framework, navigation timing, outline, main text. Read-only. */
export const PAGE_FACTS_JS = `JSON.stringify((() => {
  const fw = [];
  if (window.__NEXT_DATA__ || window.next) fw.push("Next.js");
  if (window.__NUXT__) fw.push("Nuxt");
  if (window.React || document.querySelector("[data-reactroot]") ||
      [...document.querySelectorAll("body > div")].some((d) => Object.keys(d).some((k) => k.startsWith("__react")))) fw.push("React");
  if (window.Vue || document.querySelector("[data-v-app]")) fw.push("Vue");
  const ng = document.querySelector("[ng-version]");
  if (ng) fw.push("Angular " + ng.getAttribute("ng-version"));
  if (window.jQuery) fw.push("jQuery " + ((window.jQuery.fn && window.jQuery.fn.jquery) || ""));
  const nav = performance.getEntriesByType("navigation")[0] || {};
  const main = document.querySelector("main, [role=main], article") || document.body;
  return {
    framework: fw, status: nav.responseStatus || null,
    dclMs: Math.round(nav.domContentLoadedEventEnd || 0), loadMs: Math.round(nav.loadEventEnd || 0),
    headings: [...document.querySelectorAll("h1,h2,h3")].slice(0, 8).map((h) => h.tagName.toLowerCase() + " " + h.innerText.trim().slice(0, 80)),
    forms: document.forms.length, iframes: document.querySelectorAll("iframe").length,
    text: ((main && main.innerText) || "").replace(/\\s+/g, " ").trim().slice(0, 300),
  };
})())`;

export const PAGE_TEXT_JS = "document.body ? document.body.innerText : ''";

/** The single batch a brief needs, in the order `briefParts` reads it. */
export const BRIEF_STEPS: readonly (readonly string[])[] = [
  ["get", "url"],
  ["get", "title"],
  ["snapshot", "-i"],
  ["console"],
  ["errors"],
  ["network", "requests"],
  ["cookies"],
  ["storage", "local"],
  ["storage", "session"],
];

/** Log lengths only: used for offsets before navigation and before/after actions. */
export const LOG_STEPS: readonly (readonly string[])[] = [["get", "url"], ["console"], ["errors"], ["network", "requests"]];

function rec(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function toConsole(v: unknown): ConsoleEntry[] {
  return arr(rec(v).messages).map((m) => ({ type: str(rec(m).type) || "log", text: str(rec(m).text) }));
}

export function toErrors(v: unknown): ErrorEntry[] {
  return arr(rec(v).errors).map((e) => ({ text: str(rec(e).text) || str(rec(e).message) }));
}

export function toRequests(v: unknown): RequestEntry[] {
  return arr(rec(v).requests).map((r) => {
    const o = rec(r);
    const entry: RequestEntry = { requestId: str(o.requestId), url: str(o.url), method: str(o.method) || "GET" };
    const status = num(o.status);
    if (status !== undefined) entry.status = status;
    if (typeof o.resourceType === "string") entry.resourceType = o.resourceType;
    if (typeof o.mimeType === "string") entry.mimeType = o.mimeType;
    return entry;
  });
}

function toCookies(v: unknown): CookieEntry[] {
  return arr(rec(v).cookies).map((c) => {
    const o = rec(c);
    const entry: CookieEntry = { name: str(o.name) };
    if (typeof o.domain === "string") entry.domain = o.domain;
    if (typeof o.httpOnly === "boolean") entry.httpOnly = o.httpOnly;
    if (typeof o.secure === "boolean") entry.secure = o.secure;
    const expires = num(o.expires);
    if (expires !== undefined) entry.expires = expires;
    if (typeof o.session === "boolean") entry.session = o.session;
    return entry;
  });
}

export function toPageFacts(evalResult: unknown): PageFacts {
  let v = rec(evalResult).result;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v) as unknown;
    } catch {
      v = {};
    }
  }
  const o = rec(v);
  return {
    framework: arr(o.framework).map(String),
    status: num(o.status) ?? null,
    dclMs: num(o.dclMs) ?? 0,
    loadMs: num(o.loadMs) ?? 0,
    headings: arr(o.headings).map(String),
    forms: num(o.forms) ?? 0,
    iframes: num(o.iframes) ?? 0,
    text: str(o.text),
  };
}

export type BriefParts = {
  url: string;
  title: string;
  snapshot: string;
  console: ConsoleEntry[];
  errors: ErrorEntry[];
  requests: RequestEntry[];
  cookies: CookieEntry[];
  localStorage: Record<string, unknown>;
  sessionStorage: Record<string, unknown>;
};

/** Map the results of `BRIEF_STEPS` (agent-browser JSON) into typed parts. */
export function briefParts(results: readonly BatchStepResult[]): BriefParts {
  const r = (i: number): unknown => results[i]?.result;
  return {
    url: str(rec(r(0)).url),
    title: str(rec(r(1)).title),
    snapshot: str(rec(r(2)).snapshot),
    console: toConsole(r(3)),
    errors: toErrors(r(4)),
    requests: toRequests(r(5)),
    cookies: toCookies(r(6)),
    localStorage: rec(rec(r(7)).data),
    sessionStorage: rec(rec(r(8)).data),
  };
}

export function logCounts(results: readonly BatchStepResult[]): LogCounts & { url: string } {
  return {
    url: str(rec(results[0]?.result).url),
    console: toConsole(results[1]?.result).length,
    errors: toErrors(results[2]?.result).length,
    requests: toRequests(results[3]?.result).length,
  };
}
