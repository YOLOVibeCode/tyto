import {
  BRIEF_STEPS,
  EXIT,
  LOG_STEPS,
  PAGE_FACTS_JS,
  PAGE_TEXT_JS,
  afterAction,
  assembleBrief,
  briefParts,
  findLines,
  isApi,
  logCounts,
  normalizeRefs,
  renderBrief,
  toBase64Utf8,
  toConsole,
  toErrors,
  toPageFacts,
  toRequests,
  type BrowserRunner,
  type LogMarks,
  type Redactor,
} from "@tyto/core";

export type BrowseDeps = {
  runner: BrowserRunner;
  marks: LogMarks;
  redactor: Redactor;
  /** agent-browser session used when `--session` is not given. */
  session: string;
  now: () => number;
};

type Out = { out: (line: string) => void; err: (line: string) => void };

export const ACTIONS = new Set(["click", "dblclick", "fill", "type", "press", "select", "check", "uncheck", "hover", "scroll"]);
const LOCATORS = new Set(["role", "text", "label", "placeholder", "alt", "title", "testid", "first", "last", "nth"]);
const MAX_FAILED_BODIES = 3;
/**
 * Settle before reporting: wait for the load event. Never pass env overrides here — agent-browser restarts the
 * session's browser when launch settings change mid-session (the page is lost).
 */
const SETTLE: readonly string[] = ["wait", "--load", "load"];

type Flags = { session: string; json: boolean; rest: string[] };

/** Drop agent-browser's own restore/save status lines. */
function quiet(text: string): string {
  return text
    .split("\n")
    .filter((l) => !/^\[agent-browser\] (?:restore|launched browser)/.test(l))
    .join("\n")
    .trimEnd();
}

/** Pull `--session <name>` and `--json` out of the arguments. */
export function browseFlags(args: readonly string[], defaultSession: string): Flags {
  const rest: string[] = [];
  let session = defaultSession;
  let json = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i] ?? "";
    if (a === "--json") json = true;
    else if (a === "--session" && args[i + 1] !== undefined) {
      session = args[i + 1] ?? defaultSession;
      i += 1;
    } else if (a.startsWith("--session=")) session = a.slice("--session=".length);
    else rest.push(a);
  }
  return { session, json, rest };
}

async function failedBodies(runner: BrowserRunner, session: string, requests: ReturnType<typeof toRequests>): Promise<Record<string, string>> {
  const bodies: Record<string, string> = {};
  const failed = requests.filter((r) => isApi(r) && (r.status ?? 0) >= 400).slice(0, MAX_FAILED_BODIES);
  for (const r of failed) {
    const res = await runner.run(["network", "request", r.requestId, "--json"], { session });
    try {
      const data = (JSON.parse(res.stdout) as { data?: { responseBody?: unknown } }).data;
      if (typeof data?.responseBody === "string") bodies[r.requestId] = data.responseBody;
    } catch {
      bodies[r.requestId] = "";
    }
  }
  return bodies;
}

export async function brief(args: readonly string[], deps: BrowseDeps, io: Out): Promise<number> {
  const f = browseFlags(args, deps.session);
  const results = await deps.runner.batch([...BRIEF_STEPS, ["eval", "-b", toBase64Utf8(PAGE_FACTS_JS)]], { session: f.session });
  const parts = briefParts(results);
  const mark = await deps.marks.get(f.session);
  const bodies = await failedBodies(deps.runner, f.session, parts.requests.slice(mark.requests));
  const b = assembleBrief({ ...parts, page: toPageFacts(results.at(-1)?.result), bodies, mark, now: deps.now() }, deps.redactor);
  io.out(f.json ? JSON.stringify(b) : renderBrief(b));
  return EXIT.hit;
}

export async function open(args: readonly string[], deps: BrowseDeps, io: Out): Promise<number> {
  const f = browseFlags(args, deps.session);
  const url = f.rest[0];
  if (!url) {
    io.err("usage: tyto open <url> [--session name] [--json]");
    return EXIT.usage;
  }
  const counts = logCounts(await deps.runner.batch(LOG_STEPS, { session: f.session }));
  await deps.marks.set(f.session, { console: counts.console, errors: counts.errors, requests: counts.requests });
  const opened = await deps.runner.run(["open", url], { session: f.session });
  if (opened.exitCode !== 0) {
    io.err(`open failed: ${(opened.stderr || opened.stdout).trim().slice(0, 300)}`);
    return EXIT.miss;
  }
  await deps.runner.run(SETTLE, { session: f.session });
  return brief([...(f.json ? ["--json"] : []), "--session", f.session], deps, io);
}

export async function find(args: readonly string[], deps: BrowseDeps, io: Out): Promise<number> {
  const f = browseFlags(args, deps.session);
  if (f.rest[0] && LOCATORS.has(f.rest[0])) {
    const res = await deps.runner.run(["find", ...normalizeRefs(f.rest)], { session: f.session });
    if (quiet(res.stdout)) io.out(quiet(res.stdout));
    if (quiet(res.stderr)) io.err(quiet(res.stderr));
    return res.exitCode === 0 ? EXIT.hit : EXIT.miss;
  }
  const query = f.rest.join(" ");
  if (!query) {
    io.err("usage: tyto find <words> [--session name]");
    return EXIT.usage;
  }
  const results = await deps.runner.batch([["eval", "-b", toBase64Utf8(PAGE_TEXT_JS)]], { session: f.session });
  const value = (results[0]?.result as { result?: unknown } | undefined)?.result;
  const found = findLines(typeof value === "string" ? deps.redactor.safe(value) : "", query);
  if (!found.count) {
    io.out(`no line contains all of: ${query}`);
    return EXIT.miss;
  }
  io.out(`${found.count} match(es) for '${query}' (line ⏎ next lines):`);
  for (const h of found.hits) io.out(`  • ${h}`);
  return EXIT.hit;
}

export async function act(command: string, args: readonly string[], deps: BrowseDeps, io: Out): Promise<number> {
  const f = browseFlags(args, deps.session);
  const before = logCounts(await deps.runner.batch(LOG_STEPS, { session: f.session }));
  const res = await deps.runner.run(normalizeRefs([command, ...f.rest]), { session: f.session });
  if (quiet(res.stdout)) io.out(quiet(res.stdout));
  if (quiet(res.stderr)) io.err(quiet(res.stderr));
  await deps.runner.run(SETTLE, { session: f.session });
  const after = await deps.runner.batch(LOG_STEPS, { session: f.session });
  io.out(
    afterAction(before, {
      url: (after[0]?.result as { url?: string } | undefined)?.url ?? "",
      console: toConsole(after[1]?.result),
      errors: toErrors(after[2]?.result),
      requests: toRequests(after[3]?.result),
    }),
  );
  return res.exitCode === 0 ? EXIT.hit : EXIT.miss;
}
