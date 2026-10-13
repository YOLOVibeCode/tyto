import type { Recipe } from "../recipe/types.ts";

export type RecipeSummary = {
  name: string;
  intent: string;
  params: readonly string[];
  status: Recipe["status"];
  auth: boolean;
};

export interface RecipeStore {
  get(name: string): Promise<Recipe | null>;
  list(): Promise<RecipeSummary[]>;
  /** Rejects recipes that fail parse or lint. */
  save(recipe: Recipe): Promise<void>;
  remove(name: string): Promise<boolean>;
}
