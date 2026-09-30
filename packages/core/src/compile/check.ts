import { lintRecipe } from "../recipe/lint.ts";
import { parseRecipe } from "../recipe/parse.ts";
import type { Recipe } from "../recipe/types.ts";

export type CheckResult = { ok: true; recipe: Recipe } | { ok: false; errors: string[] };

/** Everything a compiled recipe must pass before it is stored. It is always stored as a draft. */
export function checkCompiled(raw: unknown, allowed: { readonly origins: readonly string[] }): CheckResult {
  const parsed = parseRecipe(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const problems = lintRecipe(parsed.recipe);
  const outside = parsed.recipe.origins.filter((o) => !allowed.origins.includes(o));
  if (outside.length) problems.push(`origins not visited in the trace: ${outside.join(", ")}`);
  if (problems.length) return { ok: false, errors: problems };
  return { ok: true, recipe: { ...parsed.recipe, status: "draft" } };
}
