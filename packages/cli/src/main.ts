import { EXIT, executeRecipe, type ExecDeps, type RecipeStore } from "@tyto/core";

export type CliDeps = {
  store: RecipeStore;
  exec: ExecDeps;
  out: (line: string) => void;
  err: (line: string) => void;
};

export const USAGE = `usage: tyto <command>

  tyto run <recipe> [--param value ...]   replay a recipe with no model (exit 0 hit, 3 miss)
  tyto test <recipe>                      run the recipe's regression cases
  tyto recipes [--json]                   list recipes
  tyto recipes show <recipe>              print a recipe
  tyto recipes rm <recipe>                delete a recipe`;

class UsageError extends Error {}

function parseParams(args: readonly string[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    const m = /^--(\w+)(?:=(.*))?$/s.exec(arg);
    if (!m?.[1]) throw new UsageError(`expected --param value, got ${arg}`);
    if (m[2] !== undefined) params[m[1]] = m[2];
    else {
      const value = args[i + 1];
      if (value === undefined) throw new UsageError(`--${m[1]} needs a value`);
      params[m[1]] = value;
      i += 1;
    }
  }
  return params;
}

function subset(expected: Readonly<Record<string, unknown>>, actual: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([k, v]) => JSON.stringify(actual[k]) === JSON.stringify(v));
}

async function run(args: readonly string[], deps: CliDeps): Promise<number> {
  const [name, ...rest] = args;
  if (!name) throw new UsageError("tyto run needs a recipe name");
  const recipe = await deps.store.get(name);
  if (!recipe) {
    deps.err(`unknown recipe: ${name} (see tyto recipes)`);
    return EXIT.usage;
  }
  const outcome = await executeRecipe(recipe, parseParams(rest), deps.exec);
  switch (outcome.kind) {
    case "hit":
      deps.out(JSON.stringify(outcome.result));
      return EXIT.hit;
    case "miss":
      deps.out(JSON.stringify({ miss: outcome.miss, step: outcome.step }));
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
      case undefined:
      case "help":
      case "--help":
      case "-h":
        deps.out(USAGE);
        return EXIT.hit;
      default:
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
