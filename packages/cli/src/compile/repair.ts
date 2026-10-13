import { EXIT, appendRegression, executeRecipe, repairRecipe, type Compiler, type ExecDeps, type RecipeStore } from "@tyto/core";
import { UsageError, asStrings, parseParams, subset } from "../args.ts";

export type RepairDeps = { store: RecipeStore; compiler: Compiler; exec: ExecDeps };
type Io = { out: (line: string) => void; err: (line: string) => void };

/** Repair a recipe that misses on an input; replace it only if every known input then passes. */
export async function repair(args: readonly string[], deps: RepairDeps, io: Io): Promise<number> {
  const name = args[0];
  if (!name) throw new UsageError("tyto repair needs a recipe name and the input that missed");
  const recipe = await deps.store.get(name);
  if (!recipe) {
    io.err(`unknown recipe: ${name}`);
    return EXIT.usage;
  }
  const params = parseParams(args.slice(1));
  const first = await executeRecipe(recipe, params, deps.exec);
  if (first.kind === "hit") {
    await deps.store.save(appendRegression(recipe, asStrings(first.params)));
    io.out(`${name} already answers ${JSON.stringify(params)}; nothing to repair`);
    return EXIT.hit;
  }
  if (first.kind === "error") {
    io.err(first.message);
    return first.code;
  }
  io.out(`${name} missed (${first.miss}); repairing in one model session…`);
  const repaired = await repairRecipe(recipe, [{ params, reason: first.miss }], deps.compiler);
  if (!repaired.ok) {
    io.err(`repair rejected; the old recipe is unchanged:\n${repaired.errors.map((e) => `- ${e}`).join("\n")}`);
    return EXIT.invalid;
  }
  const candidate = repaired.recipe;
  if (candidate.auth) {
    await deps.store.save(appendRegression(candidate, params));
    io.out(`repaired ${name} and saved it as a draft. It uses your logins, so review and approve it again:`);
    io.out(`  tyto recipes approve ${name}   then   tyto test ${name}`);
    return EXIT.hit;
  }
  const cases = [{ params, expect: {} }, ...recipe.regression];
  const failures: string[] = [];
  for (const c of cases) {
    const o = await executeRecipe(candidate, c.params, deps.exec);
    if (o.kind === "hit" && subset(c.expect, o.result)) continue;
    failures.push(`${JSON.stringify(c.params)} → ${o.kind === "miss" ? o.miss : o.kind === "error" ? o.message : "unexpected result"}`);
  }
  if (failures.length) {
    io.out(`repair rejected; the old recipe is unchanged. The repaired version failed:\n${failures.map((f) => `- ${f}`).join("\n")}`);
    return EXIT.miss;
  }
  await deps.store.save(appendRegression(candidate, params));
  io.out(`repaired ${name}: all ${cases.length} known inputs pass`);
  return EXIT.hit;
}
