/**
 * Wait for HTML injected after parse (CSR, hydrate, innerHTML, SPA).
 * DOMContentLoaded is "the file parsed." This is "the page wrote itself."
 */

import type { CDPSession } from "playwright";
import type { ObserveTape } from "./observe.ts";

export type DocShape = "static" | "shell" | "injected";

export type DocStats = {
  textLen: number;
  elements: number;
  tables: number;
  mainLen: number;
  axNodes: number;
  shape: DocShape;
  shellMarker: boolean;
};

const SHELL_RE =
  /jump to content|enable javascript|you need to enable javascript|loading\.\.\.|id=["']root["']|id=["']app["']/i;

async function evaluateJson<T>(
  cdp: CDPSession,
  expression: string,
  awaitPromise = false,
): Promise<T | null> {
  const out = (await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise,
  })) as { result?: { value?: T }; exceptionDetails?: unknown };
  if (out.exceptionDetails) return null;
  return out.result?.value ?? null;
}

export async function axNodeCount(cdp: CDPSession): Promise<number> {
  try {
    await cdp.send("Accessibility.enable");
    const { frameTree } = (await cdp.send("Page.getFrameTree")) as { frameTree: any };
    const frames: any[] = [];
    const collect = (node: any) => {
      if (node?.frame) frames.push(node.frame);
      for (const child of node?.childFrames ?? []) collect(child);
    };
    collect(frameTree);
    let n = 0;
    for (const frame of frames) {
      try {
        const { nodes } = (await cdp.send("Accessibility.getFullAXTree", {
          frameId: frame.id,
        })) as { nodes: any[] };
        n += nodes?.length ?? 0;
      } catch {
        /* cross-origin */
      }
    }
    return n;
  } catch {
    return 0;
  }
}

export async function readDocStats(cdp: CDPSession): Promise<DocStats> {
  const raw = await evaluateJson<{
    textLen: number;
    elements: number;
    tables: number;
    mainLen: number;
    textStart: string;
    htmlHead: string;
  }>(
    cdp,
    `(() => {
      const main = document.querySelector('main, [role="main"], #mw-content-text, #content, #root, #app, #__next, #__nuxt') || document.body;
      const text = (document.body && document.body.innerText) ? document.body.innerText : "";
      return {
        textLen: text.length,
        elements: document.querySelectorAll("*").length,
        tables: document.querySelectorAll("table, tr").length,
        mainLen: (main && main.innerText) ? main.innerText.length : 0,
        textStart: text.slice(0, 240),
        htmlHead: (document.documentElement.innerHTML || "").slice(0, 500),
      };
    })()`,
  );
  const axNodes = await axNodeCount(cdp);
  const textLen = raw?.textLen ?? 0;
  const elements = raw?.elements ?? 0;
  const tables = raw?.tables ?? 0;
  const mainLen = raw?.mainLen ?? 0;
  const blob = `${raw?.textStart ?? ""} ${raw?.htmlHead ?? ""}`;
  const shellMarker = SHELL_RE.test(blob);
  const looksShell =
    shellMarker || (textLen < 3500 && mainLen < 1200 && tables < 3);
  const shape: DocShape = looksShell ? "shell" : "static";
  return { textLen, elements, tables, mainLen, axNodes, shape, shellMarker };
}

function classifyAfter(before: DocStats, after: DocStats): DocShape {
  if (after.shellMarker && after.tables < 3 && after.mainLen < 4000) return "shell";
  const grew =
    after.textLen > before.textLen + 1500 ||
    after.mainLen > before.mainLen + 800 ||
    after.tables > before.tables + 2;
  if (grew && !after.shellMarker) return "injected";
  if (after.shape !== "shell") return after.shape;
  return "shell";
}

export async function waitForInjectedHtml(
  cdp: CDPSession,
  tape: ObserveTape,
  timeoutMs = 5000,
): Promise<{ stats: DocStats; ms: number; shape: DocShape }> {
  const t0 = performance.now();
  const before = await readDocStats(cdp);
  tape.push(
    "dom",
    `parse  text=${before.textLen} els=${before.elements} main=${before.mainLen} ax=${before.axNodes} shape=${before.shape}`,
  );

  if (before.shape !== "shell") {
    return { stats: before, ms: performance.now() - t0, shape: before.shape };
  }

  tape.push("dom", "shell — waiting for injected HTML");

  const grown = await evaluateJson<{
    textLen: number;
    elements: number;
    mainLen: number;
    added: number;
    timeout?: boolean;
  }>(
    cdp,
    `(() => new Promise((resolve) => {
      const root = document.querySelector('main, [role="main"], #mw-content-text, #content, #root, #app, #__next, #__nuxt') || document.documentElement;
      const started = Date.now();
      let last = Date.now();
      let added = 0;
      const snapshot = () => {
        const body = document.body ? document.body.innerText : "";
        const main = root && root.innerText ? root.innerText : "";
        const shellish = /jump to content|enable javascript/i.test(body);
        return {
          textLen: body.length,
          elements: document.querySelectorAll("*").length,
          mainLen: main.length,
          tables: document.querySelectorAll("table, tr").length,
          added,
          shellish,
        };
      };
      const obs = new MutationObserver((muts) => {
        last = Date.now();
        for (const m of muts) added += m.addedNodes.length;
      });
      obs.observe(root, { childList: true, subtree: true, characterData: true });
      const tick = setInterval(() => {
        const s = snapshot();
        const quiet = Date.now() - last > 350;
        const rich = !s.shellish && (s.mainLen > 2500 || s.tables > 0);
        const grew = s.added > 40;
        if (quiet && (rich || (grew && !s.shellish))) {
          clearInterval(tick);
          obs.disconnect();
          resolve(s);
        }
      }, 120);
      setTimeout(() => {
        clearInterval(tick);
        obs.disconnect();
        resolve({ ...snapshot(), timeout: true });
      }, ${timeoutMs});
    }))()`,
    true,
  );

  // AX can lag DOM. Poll until node count plateaus or we leave the shell.
  let after = await readDocStats(cdp);
  let lastAx = after.axNodes;
  const deadline = Date.now() + Math.min(4000, timeoutMs);
  while (Date.now() < deadline && after.shape === "shell") {
    await new Promise((r) => setTimeout(r, 250));
    after = await readDocStats(cdp);
    if (Math.abs(after.axNodes - lastAx) < 5 && after.axNodes > before.axNodes + 10) break;
    lastAx = after.axNodes;
  }

  const shape = classifyAfter(before, after);
  const extra = grown?.timeout ? " (observer timeout)" : "";
  tape.push(
    "dom",
    `ready  text=${after.textLen} els=${after.elements} main=${after.mainLen} ax=${after.axNodes} shape=${shape}${extra}`,
  );
  return { stats: after, ms: performance.now() - t0, shape };
}
