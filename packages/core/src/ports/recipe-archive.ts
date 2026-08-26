import type { Origin, Recipe } from "../types.ts";

export interface RecipeArchive {
  remember(origin: Origin, recipe: Recipe): void;
  lookup(origin: Origin, role: string, name: string): Recipe | null;
}
