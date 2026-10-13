import type { Redactor } from "../ports/redactor.ts";
import { isSensitiveLocator } from "../recipe/lint.ts";
import { actionToArgv } from "./argv.ts";
import type { StreamEvent, Trace, TraceInput, TraceStep } from "./types.ts";

export type TraceOptions = { name: string; session: string; task?: string; redactor: Redactor; now: () => number; startedAt?: number };

const OUTPUT_LIMIT = { snapshot: 4000, result: 1500, other: 600 } as const;
/** Actions whose value the user typed, and the param holding it. */
const TYPED: Readonly<Record<string, string>> = { fill: "value", type: "text", keyboard: "text" };
const FIND_ACTIONS = new Set(["getbyrole", "getbytext", "getbylabel", "getbyplaceholder", "getbyalttext", "getbytitle", "getbytestid", "nth"]);

function rec(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function typedKey(action: string, params: Record<string, unknown>): string | null {
  if (TYPED[action] && typeof params[TYPED[action] ?? ""] === "string") return TYPED[action] ?? null;
  if (FIND_ACTIONS.has(action) && (params.subaction === "fill" || params.subaction === "type") && typeof params.value === "string") return "value";
  return null;
}

function locatorOf(action: string, params: Record<string, unknown>): string {
  return [params.selector, params.label, params.placeholder, params.text, params.role, params.name, params.testId]
    .filter((v) => typeof v === "string" && v !== "" && v !== params.value)
    .join(" ") || action;
}

function summarize(data: unknown, redactor: Redactor): string {
  const { lifecycle: _lifecycle, ...d } = rec(data);
  if (typeof d.snapshot === "string") return redactor.safe(d.snapshot).slice(0, OUTPUT_LIMIT.snapshot);
  if ("result" in d) {
    const r = d.result;
    return redactor.safe(typeof r === "string" ? r : JSON.stringify(r) ?? "").slice(0, OUTPUT_LIMIT.result);
  }
  if (Array.isArray(d.cookies)) {
    return JSON.stringify({ cookies: d.cookies.map((c) => ({ name: rec(c).name, length: String(rec(c).value ?? "").length })) });
  }
  if (d.data && typeof d.data === "object") {
    return JSON.stringify({ storage: Object.fromEntries(Object.entries(rec(d.data)).map(([k, v]) => [k, String(v).length])) });
  }
  const text = JSON.stringify(d);
  return text === "{}" ? "" : redactor.safe(text).slice(0, OUTPUT_LIMIT.other);
}

function errorOf(ev: StreamEvent): string | null {
  const e = ev.error ?? rec(ev.data).error;
  if (e === undefined || e === null || e === "") return null;
  return typeof e === "string" ? e : JSON.stringify(e);
}

function origin(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * Turn recorded stream events into a trace the compiler can read. Typed values become `{{input_N}}`, or
 * `{{param}}` when the user kept them via `keep` (input_N → param name); every other value is dropped here.
 */
export function buildTrace(
  events: readonly StreamEvent[],
  opts: TraceOptions,
  keep: Readonly<Record<string, string>>,
): { trace: Trace; inputs: TraceInput[] } {
  const steps: TraceStep[] = [];
  const pending = new Map<string, number>();
  const gaps: string[] = [];
  const origins: string[] = [];
  const inputs: TraceInput[] = [];
  const params: Record<string, string> = {};
  const addOrigin = (u: unknown): void => {
    const o = origin(u);
    if (o && !origins.includes(o)) origins.push(o);
  };

  for (const ev of events) {
    if (ev.type === "command") {
      const action = String(ev.action ?? "");
      const p = { ...rec(ev.params) };
      if (action === "navigate") addOrigin(p.url);
      const key = typedKey(action, p);
      if (key) {
        const locator = locatorOf(action, p);
        const name = `input_${inputs.length + 1}`;
        const sensitive = isSensitiveLocator(locator);
        inputs.push({ name, locator, sensitive, step: steps.length + 1 });
        const kept = keep[name];
        if (kept && !sensitive) {
          params[kept] = String(p[key]);
          p[key] = `{{${kept}}}`;
        } else {
          p[key] = sensitive ? "‹secret›" : `{{${name}}}`;
        }
      }
      const argv = actionToArgv(action, p);
      steps.push({ argv: argv ? argv.map((a) => (action === "evaluate" ? opts.redactor.safe(a) : a)) : null, action, output: "", error: null });
      pending.set(String(ev.id), steps.length - 1);
    } else if (ev.type === "result") {
      const index = pending.get(String(ev.id));
      if (index === undefined) {
        gaps.push(`result ${String(ev.id)} (${String(ev.action)}) without a command`);
        continue;
      }
      pending.delete(String(ev.id));
      const step = steps[index];
      if (step) {
        step.output = summarize(ev.data, opts.redactor);
        step.error = errorOf(ev);
      }
    } else if (ev.type === "url") {
      addOrigin(ev.url);
    } else if (ev.type === "closed") {
      gaps.push("event stream closed while recording");
    }
  }
  for (const [id, index] of pending) gaps.push(`command ${id} (${steps[index]?.action ?? "?"}) without a result`);

  return {
    trace: {
      name: opts.name,
      task: opts.task ?? "",
      session: opts.session,
      startedAt: opts.startedAt ?? opts.now(),
      stoppedAt: opts.now(),
      lossy: gaps.length > 0,
      gaps,
      origins,
      params,
      steps,
    },
    inputs,
  };
}
