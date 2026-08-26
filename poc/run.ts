/**
 * Tyto POC — staged navigation with a live CDP tape.
 *
 *   OBSERVE  console / nav / JS exceptions / network (Debugger off)
 *   BROWSE   AX snapshot — only on first look, navigation, or bind miss
 *   THINK    one model call: plan + durable anchors
 *   ACT      trusted input for writes; JS evaluate for reads
 *   WAIT     tape events + injected-HTML ready (not just DOMContentLoaded)
 *
 * Usage:
 *   npx tsx poc/run.ts
 *   npx tsx poc/run.ts --goal "..." --url "https://en.wikipedia.org/wiki/Main_Page"
 *
 * Model: TYTO_BASE_URL + TYTO_API_KEY, local OpenAI-compatible :11434, or ANTHROPIC_API_KEY.
 */

import { chromium, type Page, type CDPSession } from "playwright";
import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ObserveTape, attachObserve, waitAfterAct } from "./observe.ts";
import { waitForInjectedHtml } from "./inject.ts";

const DEFAULT_URL = "https://en.wikipedia.org/wiki/Main_Page";
const DEFAULT_GOAL =
  "Find the Wikipedia article for the barn owl (Tyto alba) and extract its conservation status.";
const MAX_TURNS = 10;
const TREE_CHAR_LIMIT = 14_000;

type Recipe = { role: string; name: string };
type Anchor = { id: string } & Recipe;
type Step =
  | { op: "click"; role: string; name: string; ref?: string }
  | { op: "fill"; role: string; name: string; text: string; ref?: string }
  | { op: "press"; key: string }
  | { op: "extract"; query: string }
  | { op: "done"; reason: string };

type Plan = { anchors: Anchor[]; steps: Step[]; rationale: string };

type RefEntry = {
  ref: string;
  role: string;
  name: string;
  backendNodeId: number;
};

type Snapshot = {
  url: string;
  title: string;
  tree: string;
  refs: Map<string, RefEntry>;
  recipes: RecipeHit[];
  tape: string;
  ms: number;
};

type RecipeHit = Recipe & { ref: string; backendNodeId: number };

type Timing = {
  stage: "browse" | "think" | "act" | "wait" | "ready" | "extract";
  ms: number;
  detail: string;
};

const INTERACTIVE = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "checkbox",
  "radio",
  "tab",
  "menuitem",
  "switch",
  "option",
]);

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function now() {
  return performance.now();
}

function fmt(ms: number) {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function normalizeRole(role: string) {
  return role.toLowerCase();
}

function nameOf(node: any): string {
  return String(node?.name?.value ?? "").trim();
}

function roleOf(node: any): string {
  return normalizeRole(String(node?.role?.value ?? "unknown"));
}

function compactAx(
  nodes: any[],
  refStart = 1,
): { tree: string; refs: Map<string, RefEntry>; recipes: RecipeHit[]; next: number } {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const root = nodes.find((n) => !n.parentId) ?? nodes[0];
  const refs = new Map<string, RefEntry>();
  const recipes: RecipeHit[] = [];
  const lines: string[] = [];
  let next = refStart;
  let links = 0;

  const walk = (node: any, depth: number) => {
    if (!node) return;
    const kids = node.childIds ?? [];
    if (node.ignored) {
      for (const id of kids) walk(byId.get(id), depth);
      return;
    }

    const role = roleOf(node);
    const name = nameOf(node);
    const backendNodeId = node.backendDOMNodeId as number | undefined;
    const isInteractive = INTERACTIVE.has(role) && !!name && !!backendNodeId;

    if (role === "link" && isInteractive) {
      links += 1;
      if (links > 40) {
        for (const id of kids) walk(byId.get(id), depth + 1);
        return;
      }
    }

    const keep =
      isInteractive ||
      role === "heading" ||
      role === "search" ||
      role === "cell" ||
      role === "gridcell" ||
      role === "columnheader" ||
      role === "rowheader" ||
      (role === "statictext" && name.length > 0 && name.length < 180);

    if (keep && (name || isInteractive)) {
      let tag = "";
      if (isInteractive && next <= 80) {
        const ref = `ref_${next++}`;
        const entry = { ref, role, name, backendNodeId: backendNodeId! };
        refs.set(ref, entry);
        recipes.push({ role, name, ref, backendNodeId: backendNodeId! });
        tag = `[${ref}] `;
      }
      const pad = "  ".repeat(Math.min(depth, 6));
      lines.push(`${pad}${tag}${role}${name ? ` "${name}"` : ""}`);
    }

    for (const id of kids) walk(byId.get(id), depth + (keep ? 1 : 0));
  };

  walk(root, 0);
  return { tree: lines.join("\n"), refs, recipes, next };
}

async function browse(page: Page, cdp: CDPSession, tape: ObserveTape): Promise<Snapshot> {
  const t0 = now();
  await cdp.send("Accessibility.enable");
  const { frameTree } = (await cdp.send("Page.getFrameTree")) as { frameTree: any };
  const frames: any[] = [];
  const collect = (node: any) => {
    if (node?.frame) frames.push(node.frame);
    for (const child of node?.childFrames ?? []) collect(child);
  };
  collect(frameTree);

  const refs = new Map<string, RefEntry>();
  const recipes: RecipeHit[] = [];
  const parts: string[] = [];
  let refStart = 1;
  for (const frame of frames) {
    try {
      const { nodes } = (await cdp.send("Accessibility.getFullAXTree", {
        frameId: frame.id,
      })) as { nodes: any[] };
      const part = compactAx(nodes, refStart);
      refStart = part.next;
      for (const [k, v] of part.refs) refs.set(k, v);
      recipes.push(...part.recipes);
      if (part.tree) {
        const label = String(frame.url || "").replace(/^https?:\/\/[^/]+/, "") || "root";
        parts.push(`# frame ${label}\n${part.tree}`);
      }
    } catch {
      /* empty or cross-origin frame */
    }
  }
  let tree = parts.join("\n");
  if (tree.length > TREE_CHAR_LIMIT) tree = tree.slice(0, TREE_CHAR_LIMIT) + "\n…(truncated)";
  return {
    url: page.url(),
    title: await page.title(),
    tree,
    refs,
    recipes,
    tape: tape.dump(),
    ms: now() - t0,
  };
}

function bind(step: Step, snap: Snapshot): RefEntry | "ok" | null {
  if (step.op === "press" || step.op === "extract" || step.op === "done") return "ok";
  if (step.ref && snap.refs.has(step.ref)) return snap.refs.get(step.ref)!;
  const hits = snap.recipes.filter(
    (r) => r.role === step.role && r.name.toLowerCase() === step.name.toLowerCase(),
  );
  if (hits.length === 1) return snap.refs.get(hits[0].ref)!;
  const fuzzy = snap.recipes.filter(
    (r) =>
      r.role === step.role &&
      (r.name.toLowerCase().includes(step.name.toLowerCase()) ||
        step.name.toLowerCase().includes(r.name.toLowerCase())),
  );
  if (fuzzy.length === 1) return snap.refs.get(fuzzy[0].ref)!;
  return null;
}

function planSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["rationale", "anchors", "steps"],
    properties: {
      rationale: { type: "string" },
      anchors: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "role", "name"],
          properties: {
            id: { type: "string" },
            role: { type: "string" },
            name: { type: "string" },
          },
        },
      },
      steps: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["op"],
          properties: {
            op: { type: "string", enum: ["click", "fill", "press", "extract", "done"] },
            role: { type: "string" },
            name: { type: "string" },
            ref: { type: "string" },
            text: { type: "string" },
            key: { type: "string" },
            query: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
    },
  } as const;
}

function coerceStep(raw: any): Step | null {
  if (!raw || typeof raw !== "object") return null;
  if (raw.op === "click" || raw.op === "fill" || raw.op === "press" || raw.op === "extract" || raw.op === "done") {
    return raw as Step;
  }
  const refMatch = String(raw.ref ?? raw.target ?? "").match(/ref_\d+/);
  const ref = refMatch ? refMatch[0] : undefined;
  const action = String(raw.action ?? raw.op ?? "").toLowerCase();
  const name = String(raw.name ?? raw.label ?? "").trim();
  const role = String(raw.role ?? "").trim().toLowerCase();
  if (action === "done" || action === "extract") {
    return { op: action === "done" ? "done" : "extract", query: raw.query ?? raw.value, reason: raw.reason ?? raw.rationale };
  }
  if (action === "press" || action === "enter") {
    return { op: "press", key: raw.key ?? "Enter" };
  }
  if (action === "input" || action === "fill" || action === "type") {
    return { op: "fill", role: role || "searchbox", name, text: String(raw.text ?? raw.value ?? ""), ref };
  }
  if (action === "click" || action === "navigate") {
    return { op: "click", role, name, ref };
  }
  if (ref) return { op: "click", role, name, ref };
  return null;
}

function parsePlan(text: string): Plan {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`model did not return JSON: ${text.slice(0, 240)}`);
  const raw = JSON.parse(match[0]) as any;
  const stepsIn = Array.isArray(raw.steps) ? raw.steps : raw.action ? [raw] : [];
  const steps = stepsIn.map(coerceStep).filter(Boolean) as Step[];
  return {
    rationale: String(raw.rationale ?? raw.thought ?? ""),
    anchors: Array.isArray(raw.anchors) ? raw.anchors.filter((a: any) => a && a.role && a.name) : [],
    steps,
  };
}

async function probeCompatible(base: string, key: string): Promise<string[]> {
  const res = await fetch(`${base.replace(/\/$/, "")}/v1/models`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as any;
  return (data.data ?? []).map((m: any) => m.id).filter(Boolean);
}

function pickModel(ids: string[]) {
  const preferred = [
    process.env.TYTO_MODEL,
    "gpt-oss:20b",
    "qwen3-coder:30b",
    "qwen2.5-coder:32b",
    "qwen2.5-coder:7b",
  ].filter(Boolean) as string[];
  for (const id of preferred) if (ids.includes(id)) return id;
  return ids.find((id) => !/embed/i.test(id)) ?? ids[0];
}

let cachedProvider: Awaited<ReturnType<typeof lookupProvider>> | null = null;

async function lookupProvider() {
  const explicit = process.env.TYTO_BASE_URL;
  if (explicit) {
    const key = process.env.TYTO_API_KEY || process.env.OPENAI_API_KEY || "sk-none";
    const discovered = await probeCompatible(explicit, key);
    const model = process.env.TYTO_MODEL || pickModel(discovered) || "gpt-4.1-mini";
    return { kind: "openai", base: explicit, key, model, discovered };
  }

  try {
    const local = "http://127.0.0.1:11434";
    const discovered = await probeCompatible(local, "ollama");
    if (discovered.length) {
      const model = pickModel(discovered);
      if (!model) throw new Error("local /v1/models returned no chat models");
      return { kind: "openai", base: local, key: "ollama", model, discovered };
    }
  } catch {
    /* fall through */
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (key) {
    return {
      kind: "anthropic",
      key,
      model: process.env.TYTO_MODEL || "claude-haiku-4-5",
      discovered: [],
    };
  }
  throw new Error(
    "No model endpoint. Set TYTO_BASE_URL + TYTO_API_KEY, or run a local OpenAI-compatible server on :11434.",
  );
}

async function resolveProvider() {
  if (!cachedProvider) cachedProvider = await lookupProvider();
  return cachedProvider;
}

async function complete(prompt: string): Promise<Plan> {
  const provider = await resolveProvider();
  if (provider.kind === "openai" && provider.base) {
    const res = await fetch(`${provider.base.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: provider.model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              'You are the THINK stage. Reply with JSON only, no markdown. Shape: {"rationale":string,"anchors":[{"id":string,"role":string,"name":string}],"steps":[Step]}. Step is one of: {"op":"fill","role":string,"name":string,"text":string} | {"op":"click","role":string,"name":string} | {"op":"press","key":string} | {"op":"extract","query":string} | {"op":"done","reason":string}. steps MUST be a non-empty array. Prefer role+name over refs.',
          },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`model HTTP ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as any;
    const msg = data.choices?.[0]?.message ?? {};
    const text = typeof msg.content === "string" && msg.content.trim()
      ? msg.content
      : JSON.stringify(msg);
    return parsePlan(text);
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": provider.key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: 1024,
      temperature: 0,
      tools: [
        {
          name: "plan_navigation",
          description: "Plan the next browser actions from the accessibility tree.",
          input_schema: planSchema(),
        },
      ],
      tool_choice: { type: "tool", name: "plan_navigation" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as any;
  const tool = (data.content ?? []).find((c: any) => c.type === "tool_use");
  if (!tool) throw new Error("model returned no plan");
  return tool.input as Plan;
}

async function think(goal: string, snap: Snapshot, anchors: Anchor[], failed?: Step): Promise<{ plan: Plan; ms: number }> {
  const t0 = now();
  const interactives = [...snap.refs.values()]
    .slice(0, 25)
    .map((r) => `${r.ref}  ${r.role}  "${r.name}"`)
    .join("\n");

  const prompt = `You are the THINK stage of a browser agent. You do not click. You only plan. steps MUST contain at least one action.

Goal: ${goal}

Current page: ${snap.title}
URL: ${snap.url}

Known durable anchors from earlier (role+name, re-resolved later — never CDP ids):
${anchors.length ? JSON.stringify(anchors, null, 2) : "(none yet)"}

${failed ? `The previous step could not be bound on this page: ${JSON.stringify(failed)}` : ""}

Recent browser tape (console / nav / JS exceptions — not pixels):
${snap.tape || "(empty)"}

Interactive controls on this snapshot:
${interactives}

Full compact accessibility tree (refs valid ONLY on this snapshot):
${snap.tree}

Rules:
- Prefer role + accessible name so the ACT stage can re-bind after navigation without calling you again.
- Use ref only when two nodes share a name.
- If the search field is visible, FILL it (searchbox/combobox) then press Enter. Do not click a generic "Search" button unless there is no field.
- If the answer is already in this tree, return a single extract or done step.
- Example: {"rationale":"type the query","anchors":[{"id":"search","role":"searchbox","name":"Search Wikipedia"}],"steps":[{"op":"fill","role":"searchbox","name":"Search Wikipedia","text":"barn owl"},{"op":"press","key":"Enter"}]}`;

  let plan = await complete(prompt);
  if (!plan.steps.length) {
    plan = await complete(`${prompt}\n\nYour last reply had empty steps. Return the same JSON shape with at least one step now.`);
  }
  return { plan, ms: now() - t0 };
}

async function clickBackend(cdp: CDPSession, page: Page, backendNodeId: number) {
  await cdp.send("DOM.scrollIntoViewIfNeeded", { backendNodeId });
  const { model } = (await cdp.send("DOM.getBoxModel", { backendNodeId })) as {
    model: { content: number[] };
  };
  const c = model.content;
  const x = (c[0] + c[4]) / 2;
  const y = (c[1] + c[5]) / 2;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`no box for backendNodeId ${backendNodeId}`);
  }
  await page.mouse.click(x, y);
}

async function act(page: Page, cdp: CDPSession, step: Step, target: RefEntry | "ok"): Promise<number> {
  const t0 = now();
  if (step.op === "press") {
    await page.keyboard.press(step.key);
    return now() - t0;
  }
  if (target === "ok") return now() - t0;

  const byRole = page.getByRole(target.role as any, { name: target.name }).first();
  if ((await byRole.count()) > 0) {
    if (step.op === "click") await byRole.click();
    if (step.op === "fill") await byRole.fill(step.text);
    return now() - t0;
  }

  if (step.op === "click") {
    await clickBackend(cdp, page, target.backendNodeId);
  } else if (step.op === "fill") {
    await clickBackend(cdp, page, target.backendNodeId);
    await cdp.send("Input.insertText", { text: step.text });
  }
  return now() - t0;
}

function extractFromAx(snap: Snapshot, query: string): string | null {
  const lines = snap.tree.split("\n");
  const wantStatus = /conservation|status/i.test(query);
  const STATUSES =
    /least concern|near threatened|vulnerable|endangered|critically endangered|extinct|data deficient|leastconcern/i;
  for (let i = 0; i < lines.length; i++) {
    if (/conservation status/i.test(lines[i]) || (wantStatus && STATUSES.test(lines[i]))) {
      const window = lines.slice(i, i + 12).join(" ");
      const hit = window.match(STATUSES);
      if (hit) return `Conservation status: ${hit[0]}`;
      return lines
        .slice(i, i + 3)
        .map((l) => l.trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ");
    }
  }
  if (wantStatus) {
    const hit = snap.tree.match(STATUSES);
    if (hit) return `Conservation status: ${hit[0]}`;
  }
  return null;
}

async function extractViaJs(cdp: CDPSession, query: string): Promise<string | null> {
  const expression = `(() => {
    const q = ${JSON.stringify(query)};
    const root = document;
    const rows = [...root.querySelectorAll("tr")];
    for (const row of rows) {
      const th = (row.querySelector("th")?.textContent || "").replace(/\\s+/g, " ").trim();
      const td = (row.querySelector("td")?.textContent || "").replace(/\\s+/g, " ").trim();
      if (!th || !td) continue;
      if (/conservation status/i.test(th) && /conservation/i.test(q)) return th + ": " + td;
      if (q.length < 60 && th.toLowerCase().includes(q.toLowerCase())) return th + ": " + td;
    }
    const text = (root.body && root.body.innerText) ? root.body.innerText : "";
    const m = text.match(/Conservation status\\s+(\\S[^\\n]{2,80})/i);
    if (m && /conservation/i.test(q)) return "Conservation status: " + m[1].trim();
    return JSON.stringify({
      miss: true,
      tr: rows.length,
      textLen: text.length,
      hasMw: !!root.querySelector("#mw-content-text"),
      slice: text.slice(0, 120),
    });
  })()`;
  const out = (await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
  })) as { result?: { value?: unknown }; exceptionDetails?: unknown };
  if (out.exceptionDetails) return null;
  const value = out.result?.value;
  if (typeof value === "string" && value.startsWith("{") && value.includes('"miss"')) {
    console.log(`        js extract miss  ${value}`);
    return null;
  }
  return typeof value === "string" && value.length ? value : null;
}

async function extractAnswer(
  goal: string,
  snap: Snapshot,
  query: string,
  cdp: CDPSession,
  allowModel: boolean,
): Promise<{ text: string; ms: number; via: "ax" | "js" | "model" | "blocked" }> {
  const t0 = now();
  const ax = extractFromAx(snap, query || goal);
  if (ax) return { text: ax, ms: now() - t0, via: "ax" };
  const js = await extractViaJs(cdp, query || goal);
  if (js) return { text: js, ms: now() - t0, via: "js" };
  if (!allowModel) {
    return {
      text: "blocked: document still looks like a parse shell — injected HTML never arrived",
      ms: now() - t0,
      via: "blocked",
    };
  }
  const plan = await complete(
    `EXTRACT stage. Goal: ${goal}\nURL: ${snap.url}\nTitle: ${snap.title}\n\nTree:\n${snap.tree}\n\nReturn JSON: {"rationale":"...", "anchors":[], "steps":[{"op":"done","reason":"<the extracted answer, short>"}]}`,
  );
  const done = plan.steps.find((s) => s.op === "done");
  return {
    text: (done && done.op === "done" && done.reason) || plan.rationale,
    ms: now() - t0,
    via: "model",
  };
}

function mergeAnchors(into: Anchor[], add: Anchor[]) {
  for (const a of add) {
    const rec = { ...a, id: a.id || a.name };
    const i = into.findIndex((x) => x.id === rec.id);
    if (i >= 0) into[i] = rec;
    else into.push(rec);
  }
}

function needsTree(step?: Step) {
  if (!step) return true;
  return step.op === "click" || step.op === "fill" || step.op === "extract";
}

async function main() {
  const goal = arg("--goal", DEFAULT_GOAL);
  const url = arg("--url", DEFAULT_URL);
  const timings: Timing[] = [];
  const anchors: Anchor[] = [];
  let queue: Step[] = [];
  let answer: string | null = null;

  const provider = await resolveProvider();
  console.log("\nTyto POC  observe + browse → think → act");
  console.log(`goal  ${goal}`);
  console.log(`start ${url}`);
  if (provider.discovered.length) {
    console.log(`found  ${provider.discovered.filter((id) => !/embed/i.test(id)).join(", ")}`);
  }
  console.log(`model  ${provider.model}  via ${provider.base ?? "anthropic"}\n`);

  const profile = "./tmp/profile";
  for (const stale of ["SingletonLock", "SingletonCookie", "SingletonSocket", "RunningChromeVersion"]) {
    const p = join(profile, stale);
    if (existsSync(p)) rmSync(p);
  }

  const browser = await chromium.launchPersistentContext(profile, {
    headless: false,
    viewport: { width: 1280, height: 900 },
  });
  const page = browser.pages()[0] || (await browser.newPage());
  const cdp = await page.context().newCDPSession(page);
  const tape = new ObserveTape();
  await attachObserve(cdp, tape);

  let lastUrl = "";
  let thinksOnPage = 0;
  let snap: Snapshot | null = null;
  let dirty = true;

  await page.goto(url, { waitUntil: "domcontentloaded" });
  {
    const ready = await waitForInjectedHtml(cdp, tape);
    timings.push({ stage: "ready", ms: ready.ms, detail: ready.shape });
    console.log(`READY   ${fmt(ready.ms).padStart(7)}  ${ready.shape}  text=${ready.stats.textLen} main=${ready.stats.mainLen} ax=${ready.stats.axNodes}`);
  }

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    const stepPeek = queue[0];
    const bindOnCached = snap && stepPeek ? bind(stepPeek, snap) : null;
    const mustBrowse =
      dirty ||
      !snap ||
      (needsTree(stepPeek) && bindOnCached === null) ||
      (stepPeek?.op === "extract" && dirty);

    if (mustBrowse) {
      snap = await browse(page, cdp, tape);
      dirty = false;
      timings.push({
        stage: "browse",
        ms: snap.ms,
        detail: `${snap.refs.size} refs · ${snap.title.slice(0, 60)}`,
      });
      console.log(`BROWSE  ${fmt(snap.ms).padStart(7)}  ${snap.refs.size} interactive refs · ${snap.url}`);
    } else {
      console.log(`HOLD    skip browse — no nav, current snapshot still binds`);
    }

    if (!snap) throw new Error("snapshot missing");

    if (snap.url !== lastUrl) {
      lastUrl = snap.url;
      thinksOnPage = 0;
    }

    let step = queue[0];
    let bound = step ? bind(step, snap) : null;

    if (!step || bound === null) {
      if (thinksOnPage >= 2) {
        console.log("stuck: two THINK passes on this page still cannot bind. stopping.");
        break;
      }
      thinksOnPage += 1;
      snap = { ...snap, tape: tape.dump() };
      const { plan, ms } = await think(goal, snap, anchors, step && bound === null ? step : undefined);
      timings.push({ stage: "think", ms, detail: plan.rationale.slice(0, 80) });
      console.log(`THINK   ${fmt(ms).padStart(7)}  ${plan.rationale}`);
      console.log(`        steps: ${JSON.stringify(plan.steps)}`);
      mergeAnchors(anchors, plan.anchors);
      if (plan.anchors.length) {
        console.log(
          `        indexed anchors: ${plan.anchors.map((a) => `${a.id || a.name}=${a.role}:${a.name}`).join("; ")}`,
        );
      }
      queue = plan.steps;
      step = queue[0];
      bound = step ? bind(step, snap) : null;
    } else {
      console.log(`BIND    skip think — '${step.op}' resolved from recipe/ref`);
    }

    if (!step) {
      console.log("no steps returned");
      break;
    }

    if (step.op === "done") {
      answer = step.reason;
      queue.shift();
      break;
    }

    if (step.op === "extract") {
      const ready = await waitForInjectedHtml(cdp, tape);
      timings.push({ stage: "ready", ms: ready.ms, detail: `extract ${ready.shape}` });
      console.log(
        `READY   ${fmt(ready.ms).padStart(7)}  extract/${ready.shape}  text=${ready.stats.textLen} main=${ready.stats.mainLen}`,
      );
      snap = await browse(page, cdp, tape);
      dirty = false;
      timings.push({ stage: "browse", ms: snap.ms, detail: "extract snapshot" });
      console.log(`BROWSE  ${fmt(snap.ms).padStart(7)}  extract snapshot · ${snap.url}`);
      const extracted = await extractAnswer(goal, snap, step.query, cdp, ready.shape !== "shell");
      timings.push({
        stage: "extract",
        ms: extracted.ms,
        detail: `${extracted.via} ${extracted.text.slice(0, 80)}`,
      });
      console.log(`EXTRACT ${fmt(extracted.ms).padStart(7)}  via ${extracted.via}  ${extracted.text}`);
      answer = extracted.text;
      queue.shift();
      break;
    }

    if (bound === null) {
      console.log(`failed to bind step ${JSON.stringify(step)}`);
      queue.shift();
      dirty = true;
      continue;
    }

    const urlBefore = page.url();
    const mark = tape.events.at(-1)?.t ?? 0;
    const ms = await act(page, cdp, step, bound);
    const who = bound === "ok" ? step.op : `${step.op} ${bound.role} "${bound.name}"`;
    timings.push({ stage: "act", ms, detail: who });
    console.log(`ACT     ${fmt(ms).padStart(7)}  ${who}`);
    queue.shift();

    const waited = await waitAfterAct(tape, step.op, urlBefore, () => page.url(), mark);
    timings.push({ stage: "wait", ms: waited.ms, detail: waited.reason.slice(0, 80) });
    console.log(
      `WAIT    ${fmt(waited.ms).padStart(7)}  ${waited.navigated ? "nav" : "same"}  ${waited.reason.slice(0, 100)}`,
    );
    if (waited.navigated) {
      dirty = true;
      const ready = await waitForInjectedHtml(cdp, tape);
      timings.push({ stage: "ready", ms: ready.ms, detail: ready.shape });
      console.log(
        `READY   ${fmt(ready.ms).padStart(7)}  ${ready.shape}  text=${ready.stats.textLen} main=${ready.stats.mainLen} ax=${ready.stats.axNodes}`,
      );
    }
  }

  const by = (s: Timing["stage"]) => timings.filter((t) => t.stage === s).reduce((a, t) => a + t.ms, 0);
  console.log("\n── timing ──────────────────────────────");
  console.log(`browse  ${fmt(by("browse")).padStart(8)}   AX snapshot, no model`);
  console.log(`think   ${fmt(by("think")).padStart(8)}   model called ${timings.filter((t) => t.stage === "think").length}×`);
  console.log(`act     ${fmt(by("act")).padStart(8)}   trusted writes`);
  console.log(`wait    ${fmt(by("wait")).padStart(8)}   tape (no sleep)`);
  console.log(`ready   ${fmt(by("ready")).padStart(8)}   injected HTML (DCL is not enough)`);
  console.log(`extract ${fmt(by("extract")).padStart(8)}   AX/JS; model only if not a shell`);
  console.log(`total   ${fmt(timings.reduce((a, t) => a + t.ms, 0)).padStart(8)}`);
  const errors = tape.events.filter(
    (e) => e.kind === "exception" || (e.kind === "console" && /error|warn/.test(e.detail)),
  );
  console.log(`tape    ${String(tape.events.length).padStart(8)}   events  (${errors.length} error/warn)`);
  if (anchors.length) {
    console.log("\nanchors cached this run:");
    for (const a of anchors) console.log(`  ${a.id}: ${a.role} "${a.name}"`);
  }
  if (answer) console.log(`\nanswer  ${answer}`);
  console.log("\nbrowser stays open 8s so you can see the last page.\n");
  await page.waitForTimeout(8000);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
