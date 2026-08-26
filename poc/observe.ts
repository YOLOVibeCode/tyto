/**
 * Live CDP tape — console, navigation, JS exceptions, script loads.
 * Debugger stays off. The VM is never paused.
 */

import type { CDPSession } from "playwright";

export type TapeKind =
  | "console"
  | "exception"
  | "nav"
  | "spa"
  | "lifecycle"
  | "network"
  | "jsctx"
  | "dom";

export type TapeEvent = {
  t: number;
  kind: TapeKind;
  detail: string;
  url?: string;
};

type Waiter = {
  pred: (e: TapeEvent) => boolean;
  resolve: (e: TapeEvent) => void;
};

const TAPE_CAP = 200;
const PRINT = new Set<TapeKind>(["console", "exception", "nav", "spa", "network", "jsctx", "dom"]);
const LIFE_PRINT = new Set(["DOMContentLoaded", "load", "networkAlmostIdle", "networkIdle"]);

function remoteText(obj: any): string {
  if (obj == null) return "";
  if (obj.value != null) return String(obj.value);
  if (obj.description) return String(obj.description);
  if (obj.unserializableValue) return String(obj.unserializableValue);
  return obj.type ?? "";
}

export class ObserveTape {
  readonly events: TapeEvent[] = [];
  private waiters: Waiter[] = [];
  private origin = performance.now();

  push(kind: TapeKind, detail: string, url?: string) {
    const e: TapeEvent = { t: performance.now() - this.origin, kind, detail, url };
    this.events.push(e);
    if (this.events.length > TAPE_CAP) this.events.shift();

    const keep: Waiter[] = [];
    for (const w of this.waiters) {
      if (w.pred(e)) w.resolve(e);
      else keep.push(w);
    }
    this.waiters = keep;

    const show =
      PRINT.has(kind) || (kind === "lifecycle" && LIFE_PRINT.has(detail.split(" ")[0] ?? ""));
    if (show) {
      const ms = e.t < 1000 ? `${Math.round(e.t)}ms` : `${(e.t / 1000).toFixed(2)}s`;
      console.log(`TAPE    ${kind.padEnd(10)} ${ms.padStart(7)}  ${detail.slice(0, 160)}`);
    }
  }

  recent(n = 16): TapeEvent[] {
    return this.events.slice(-n);
  }

  since(mark: number): TapeEvent[] {
    return this.events.filter((e) => e.t >= mark);
  }

  wait(pred: (e: TapeEvent) => boolean, timeoutMs: number): Promise<TapeEvent | null> {
    const already = this.events.find(pred);
    if (already) return Promise.resolve(already);
    return new Promise((resolve) => {
      const waiter: Waiter = {
        pred,
        resolve: (e) => {
          clearTimeout(timer);
          resolve(e);
        },
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        resolve(null);
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  dump(): string {
    return this.recent(20)
      .map((e) => `${e.kind} ${e.detail}`)
      .join("\n");
  }
}

export async function attachObserve(cdp: CDPSession, tape: ObserveTape) {
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Page.enable");
  await cdp.send("Network.enable");
  await cdp.send("Page.setLifecycleEventsEnabled", { enabled: true });

  cdp.on("Runtime.consoleAPICalled", (params: any) => {
    const type = params.type ?? "log";
    const text = (params.args ?? []).map(remoteText).filter(Boolean).join(" ");
    tape.push("console", `${type} ${text}`.trim());
  });

  cdp.on("Runtime.exceptionThrown", (params: any) => {
    const d = params.exceptionDetails ?? {};
    const text =
      d.text ||
      d.exception?.description ||
      d.exception?.value ||
      "uncaught";
    const loc = d.url ? `${d.url}:${d.lineNumber ?? 0}` : "";
    tape.push("exception", `${text} ${loc}`.trim());
  });

  cdp.on("Log.entryAdded", (params: any) => {
    const e = params.entry ?? {};
    if (e.source === "network" && e.level === "verbose") return;
    tape.push("console", `${e.level ?? "info"} ${e.text ?? ""}`.trim(), e.url);
  });

  cdp.on("Page.frameNavigated", (params: any) => {
    const frame = params.frame ?? {};
    if (frame.parentId) return;
    const url = String(frame.url ?? "");
    if (!url || url === "about:blank") return;
    tape.push("nav", url, url);
  });

  cdp.on("Page.navigatedWithinDocument", (params: any) => {
    const url = String(params.url ?? "");
    if (!url) return;
    tape.push("spa", url, url);
  });

  cdp.on("Page.lifecycleEvent", (params: any) => {
    const name = String(params.name ?? "");
    if (!LIFE_PRINT.has(name)) return;
    tape.push("lifecycle", name, params.loaderId);
  });

  cdp.on("Network.responseReceived", (params: any) => {
    const type = String(params.type ?? "");
    const res = params.response ?? {};
    const status = Number(res.status ?? 0);
    const url = String(res.url ?? "");
    if (type === "Document") {
      tape.push("network", `${status} document ${url.slice(0, 120)}`, url);
      return;
    }
    if ((type === "XHR" || type === "Fetch") && status >= 400) {
      tape.push("network", `${status} ${type.toLowerCase()} ${url.slice(0, 120)}`, url);
    }
    if (type === "Script" && status >= 400) {
      tape.push("network", `${status} script ${url.slice(0, 120)}`, url);
    }
  });

  cdp.on("Runtime.executionContextCreated", (params: any) => {
    const ctx = params.context ?? {};
    if (ctx.auxData?.isDefault) return;
    const name = String(ctx.name || ctx.origin || "default");
    if (name.startsWith("__playwright")) return;
    tape.push("jsctx", `${name} ${ctx.origin ?? ""}`.trim());
  });

  cdp.on("Page.frameAttached", (params: any) => {
    tape.push("dom", `frame attached ${params.frameId ?? ""}`);
  });
}

export async function waitAfterAct(
  tape: ObserveTape,
  stepOp: string,
  urlBefore: string,
  urlNow: () => string,
  mark: number,
): Promise<{ reason: string; navigated: boolean; ms: number }> {
  const t0 = performance.now();
  const after = (e: TapeEvent) => e.t > mark;
  const expectsNav = stepOp === "press" || stepOp === "click";

  const alreadyNav =
    urlNow() !== urlBefore ||
    tape.events.some((e) => after(e) && (e.kind === "nav" || e.kind === "spa"));

  if (expectsNav || alreadyNav) {
    const nav =
      tape.events.find((e) => after(e) && (e.kind === "nav" || e.kind === "spa")) ??
      (alreadyNav
        ? null
        : await tape.wait((e) => after(e) && (e.kind === "nav" || e.kind === "spa"), 8000));

    if (nav || alreadyNav) {
      await tape.wait(
        (e) =>
          after(e) &&
          e.kind === "lifecycle" &&
          (e.detail === "DOMContentLoaded" || e.detail === "load" || e.detail === "networkAlmostIdle"),
        4000,
      );
      return {
        reason: nav?.detail ?? urlNow(),
        navigated: true,
        ms: performance.now() - t0,
      };
    }
  }

  const noise = await tape.wait(
    (e) => after(e) && (e.kind === "exception" || e.kind === "console" || e.kind === "nav" || e.kind === "spa"),
    expectsNav ? 400 : 200,
  );
  const navigated = urlNow() !== urlBefore;
  return {
    reason: noise?.detail ?? (navigated ? urlNow() : "quiet"),
    navigated,
    ms: performance.now() - t0,
  };
}
