import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { lintRecipe, parseRecipe, type Recipe, type RecipeStore, type RecipeSummary } from "@tyto/core";
import { readIfExists, writePrivate } from "./files.ts";

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function checkName(name: string): void {
  if (!NAME.test(name)) throw new Error(`invalid recipe name: ${name}`);
}

function validate(input: unknown): Recipe {
  const parsed = parseRecipe(input);
  if (!parsed.ok) throw new Error(`recipe is invalid: ${parsed.errors.join("; ")}`);
  const problems = lintRecipe(parsed.recipe);
  if (problems.length) throw new Error(`recipe fails lint: ${problems.join("; ")}`);
  return parsed.recipe;
}

/** Recipes as `<dir>/<name>.json`. Every save and load re-validates (parse + lint). */
export class FilesystemRecipeStore implements RecipeStore {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
  }

  async get(name: string): Promise<Recipe | null> {
    checkName(name);
    const text = await readIfExists(join(this.#dir, `${name}.json`));
    if (text === null) return null;
    return validate(JSON.parse(text) as unknown);
  }

  async list(): Promise<RecipeSummary[]> {
    let files: string[];
    try {
      files = await readdir(this.#dir);
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === "ENOENT") return [];
      throw err;
    }
    const out: RecipeSummary[] = [];
    for (const f of files.filter((f) => f.endsWith(".json")).sort()) {
      const recipe = await this.get(f.slice(0, -".json".length)).catch(() => null);
      if (recipe) out.push({ name: recipe.name, intent: recipe.intent, params: Object.keys(recipe.params), status: recipe.status, auth: recipe.auth });
    }
    return out;
  }

  async save(recipe: Recipe): Promise<void> {
    checkName(recipe.name);
    const valid = validate(JSON.parse(JSON.stringify(recipe)) as unknown);
    await writePrivate(join(this.#dir, `${valid.name}.json`), `${JSON.stringify(valid, null, 2)}\n`);
  }

  async remove(name: string): Promise<boolean> {
    checkName(name);
    const path = join(this.#dir, `${name}.json`);
    if ((await readIfExists(path)) === null) return false;
    await rm(path);
    return true;
  }
}
