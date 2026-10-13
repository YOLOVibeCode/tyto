import {
  BATCH_LANES,
  DEFAULT_CONCURRENCY,
  EXIT,
  appendRegression,
  executeRecipe,
  parseBatchInputs,
  runBatch,
  type Compiler,
  type ExecDeps,
  type Recipe,
  type RecipeStore,
  type TraceStore,
} from "@tyto/core";
import { approve, compile, compileTool, type CompileToolDeps } from "./compile/commands.ts";
import { repair } from "./compile/repair.ts";
import { UsageError, asStrings, paramFlags, parseParams, subset } from "./args.ts";
import { doctor, type DoctorDeps } from "./doctor.ts";
import { install, type InstallOptions } from "./install.ts";
import { ACTIONS, act, brief, find, open, type BrowseDeps } from "./browse.ts";
import { learnCommand, type LearnDeps } from "./learn/commands.ts";

export type CliDeps = {
  store: RecipeStore;
  exec: ExecDeps;
  browse: BrowseDeps;
  learn: LearnDeps;
  traces: TraceStore;
  compiler: Compiler;
  compileTool: CompileToolDeps;
  confirm: (question: string) => Promise<boolean>;
  /** Reads `tyto run --each` inputs: a file path, or `-` for stdin. Wired only in the real composition root. */
  readInput?: (path: string) => Promise<string>;
  /** Setup commands (install, doctor); wired only in the real composition root. */
  setup?: { install: InstallOptions; doctor: DoctorDeps };
  out: (line: string) => void;
  err: (line: string) => void;
};

export const USAGE = `usage: tyto <command>

  tyto install [--bin-dir d]              put tyto on PATH; add the skill for Claude Code and Cursor
  tyto doctor [--fix]                     check Node, agent-browser, Claude Code, PATH, Tyto's sessions

  tyto open <url> [--session s] [--json]  open a page and print its brief (errors, network, state, elements)
  tyto brief [--session s] [--json]       brief of the current page
  tyto find <words> [--session s]         search the whole page text
  tyto click|fill|type|press|select|check|uncheck|hover|scroll|dblclick <args>
                                          act through agent-browser, then print what happened
  tyto learn <name> [--session s]         record a task done in that agent-browser session
  tyto learn status <name>                typed inputs recorded so far (names only)
  tyto learn stop <name> --task "…" [--param input_N=name ...]   save the trace
  tyto compile <name>                     turn a recorded trace into a draft recipe (one model session)
  tyto repair <recipe> [--param value ...] fix a recipe that missed on that input (one model session)
  tyto run <recipe> [--param value ...]   replay a recipe with no model (exit 0 hit, 3 miss)
  tyto run <recipe> --each <file|-> [--concurrency N] [--param value ...]
                                          one replay per JSON line, N at a time (default ${DEFAULT_CONCURRENCY}, max ${BATCH_LANES});
                                          prints one JSON line per input, in order
  tyto test <recipe>                      run the recipe's regression cases
  tyto recipes [--json]                   list recipes
  tyto recipes show <recipe>              print a recipe
  tyto recipes approve <recipe> [--yes]   allow a recipe to run (required for recipes that use your logins)
  tyto recipes rm <recipe>                delete a recipe`;

/** In `tyto run`, `--each` and `--concurrency` are Tyto's; every other flag is a recipe param. */
function splitBatchFlags(args: readonly string[]): { each?: string; concurrency?: string; rest: string[] } {
  const found: { each?: string; concurrency?: string } = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    const m = /^--(each|concurrency)(?:=(.*))?$/s.exec(arg);
    if (!m) {
      rest.push(arg);
      continue;
    }
    const flag = m[1] as "each" | "concurrency";
    const value = m[2] ?? args[i + 1];
    if (m[2] === undefined) i += 1;
    if (value === undefined || value === "") throw new UsageError(flag === "each" ? "--each needs a file (or - for stdin)" : "--concurrency needs a number");
    found[flag] = value;
  }
  return { ...found, rest };
}

async function runEach(recipe: Recipe, file: string, concurrencyArg: string | undefined, shared: Readonly<Record<string, string>>, deps: CliDeps): Promise<number> {
  const concurrency = concurrencyArg === undefined ? DEFAULT_CONCURRENCY : /^\d+$/.test(concurrencyArg) ? Number(concurrencyArg) : NaN;
  if (!(concurrency >= 1 && concurrency <= BATCH_LANES)) throw new UsageError(`--concurrency must be a whole number from 1 to ${BATCH_LANES}`);
  if (!deps.readInput) throw new UsageError("--each is not available here");
  const label = file === "-" ? "stdin" : file;
  let text: string;
  try {
    text = await deps.readInput(file);
  } catch (e) {
    deps.err(`cannot read ${label}: ${e instanceof Error ? e.message : String(e)}`);
    return EXIT.usage;
  }
  const parsed = parseBatchInputs(text);
  if (!parsed.ok) {
    deps.err(`${label}: ${parsed.error}`);
    return EXIT.usage;
  }
  const missed: Record<string, string>[] = [];
  const outcome = await runBatch(
    recipe,
    parsed.inputs.map((input) => ({ ...shared, ...input })),
    deps.exec,
    {
      concurrency,
      onLine: (line) => {
        deps.out(JSON.stringify(line));
        if ("miss" in line) missed.push(line.input);
      },
    },
  );
  if (outcome.kind === "error") {
    deps.err(outcome.message);
    return outcome.code;
  }
  const lanes = outcome.lanes.length;
  deps.err(`batch ${recipe.name}: ${outcome.hits} hit, ${outcome.misses} miss, ${outcome.errors} ${outcome.errors === 1 ? "error" : "errors"} (${lanes} ${lanes === 1 ? "lane" : "lanes"})`);
  const first = missed[0];
  if (first) deps.err(`repair: tyto repair ${recipe.name} ${paramFlags(first)}`.trimEnd());
  const updated = outcome.passed.reduce((r, params) => appendRegression(r, asStrings(params)), recipe);
  if (updated !== recipe) await deps.store.save(updated).catch(() => undefined);
  return outcome.code;
}

async function run(args: readonly string[], deps: CliDeps): Promise<number> {
  const [name, ...flags] = args;
  if (!name) throw new UsageError("tyto run needs a recipe name");
  const recipe = await deps.store.get(name);
  if (!recipe) {
    deps.err(`unknown recipe: ${name} (see tyto recipes)`);
    return EXIT.usage;
  }
  const { each, concurrency, rest } = splitBatchFlags(flags);
  const params = parseParams(rest);
  if (each !== undefined) return runEach(recipe, each, concurrency, params, deps);
  if (concurrency !== undefined) throw new UsageError("--concurrency needs --each");
  const outcome = await executeRecipe(recipe, params, deps.exec);
  switch (outcome.kind) {
    case "hit":
      deps.out(JSON.stringify(outcome.result));
      await deps.store.save(appendRegression(recipe, asStrings(outcome.params))).catch(() => undefined);
      return EXIT.hit;
    case "miss":
      deps.out(JSON.stringify({ miss: outcome.miss, step: outcome.step }));
      deps.err(`repair: tyto repair ${name} ${paramFlags(params)}`.trimEnd());
      return EXIT.miss;
    case "error":
      deps.err(outcome.message);
      return outcome.code;
    default: {
      const never: never = outcome;
      return never;
    }
  }
}

async function test(args: readonly string[], deps: CliDeps): Promise<number> {
  const name = args[0];
  if (!name) throw new UsageError("tyto test needs a recipe name");
  const recipe = await deps.store.get(name);
  if (!recipe) {
    deps.err(`unknown recipe: ${name}`);
    return EXIT.usage;
  }
  if (!recipe.regression.length) {
    deps.out(`${name}: no regression cases`);
    return EXIT.hit;
  }
  let passed = 0;
  for (const c of recipe.regression) {
    const outcome = await executeRecipe(recipe, c.params, deps.exec);
    const ok = outcome.kind === "hit" && subset(c.expect, outcome.result);
    if (ok) passed += 1;
    const detail = outcome.kind === "hit" ? JSON.stringify(outcome.result) : outcome.kind === "miss" ? `miss: ${outcome.miss}` : outcome.message;
    deps.out(`${ok ? "PASS" : "FAIL"} ${JSON.stringify(c.params)} ${ok ? "" : `→ ${detail}`}`.trimEnd());
  }
  deps.out(`${name}: ${passed}/${recipe.regression.length} passed`);
  return passed === recipe.regression.length ? EXIT.hit : EXIT.miss;
}

async function recipes(args: readonly string[], deps: CliDeps): Promise<number> {
  const [sub, name] = args;
  if (sub === "approve") return approve(args.slice(1), deps.store, deps.confirm, deps);
  if (sub === "show" || sub === "rm") {
    if (!name) throw new UsageError(`tyto recipes ${sub} needs a recipe name`);
    if (sub === "show") {
      const recipe = await deps.store.get(name);
      if (!recipe) {
        deps.err(`unknown recipe: ${name}`);
        return EXIT.usage;
      }
      deps.out(JSON.stringify(recipe, null, 2));
      return EXIT.hit;
    }
    if (!(await deps.store.remove(name))) {
      deps.err(`unknown recipe: ${name}`);
      return EXIT.usage;
    }
    deps.out(`removed ${name}`);
    return EXIT.hit;
  }
  if (sub !== undefined && sub !== "--json") throw new UsageError(`unknown recipes subcommand: ${sub}`);
  const list = await deps.store.list();
  if (sub === "--json") {
    deps.out(JSON.stringify(list));
    return EXIT.hit;
  }
  if (!list.length) deps.out("no recipes yet");
  for (const r of list) {
    const flags = [r.status, ...(r.auth ? ["uses your logins"] : [])].join(", ");
    deps.out(`${r.name}  (${r.params.map((p) => `--${p}`).join(" ") || "no params"})  [${flags}]  ${r.intent}`);
  }
  return EXIT.hit;
}

/** Entry point with injected dependencies; returns the process exit code. */
export async function main(argv: readonly string[], deps: CliDeps): Promise<number> {
  const [command, ...args] = argv;
  try {
    switch (command) {
      case "run":
        return await run(args, deps);
      case "test":
        return await test(args, deps);
      case "recipes":
        return await recipes(args, deps);
      case "install": {
        if (!deps.setup) throw new UsageError("install is not available here");
        const i = args.indexOf("--bin-dir");
        return await install({ ...deps.setup.install, ...(i >= 0 && args[i + 1] ? { binDir: args[i + 1] ?? "" } : {}) }, deps);
      }
      case "doctor":
        if (!deps.setup) throw new UsageError("doctor is not available here");
        return await doctor(args, deps.setup.doctor, deps);
      case "repair":
        return await repair(args, deps, deps);
      case "compile":
        return await compile(args, deps, deps);
      case "compile-tool":
        return await compileTool(args, deps.compileTool, deps.exec, deps);
      case "learn":
        return await learnCommand(args, deps.learn, deps.browse.runner, deps);
      case "open":
        return await open(args, deps.browse, deps);
      case "brief":
        return await brief(args, deps.browse, deps);
      case "find":
        return await find(args, deps.browse, deps);
      case undefined:
      case "help":
      case "--help":
      case "-h":
        deps.out(USAGE);
        return EXIT.hit;
      default:
        if (ACTIONS.has(command)) return await act(command, args, deps.browse, deps);
        throw new UsageError(`unknown command: ${command}`);
    }
  } catch (e) {
    if (e instanceof UsageError) {
      deps.err(`${e.message}\n\n${USAGE}`);
      return EXIT.usage;
    }
    deps.err(e instanceof Error ? e.message : String(e));
    return EXIT.internal;
  }
}
