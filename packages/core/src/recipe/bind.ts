import type { AxSnapshot, Origin, Recipe, RefEntry, Step } from "../types.ts";

export type BindResult = RefEntry | "ok" | null;

export function bind(step: Step, snap: AxSnapshot): BindResult {
  if (step.op === "press" || step.op === "extract" || step.op === "done") return "ok";
  if (step.ref) {
    const hit = snap.refs.get(step.ref);
    if (!hit) return null;
    return hit;
  }
  const role = step.role.toLowerCase();
  const name = step.name.toLowerCase();
  const hits = snap.recipes.filter(
    (r) => r.role.toLowerCase() === role && r.name.toLowerCase() === name,
  );
  if (hits.length === 1) return snap.refs.get(hits[0]!.ref) ?? null;
  const fuzzy = snap.recipes.filter(
    (r) =>
      r.role.toLowerCase() === role &&
      (r.name.toLowerCase().includes(name) || name.includes(r.name.toLowerCase())),
  );
  if (fuzzy.length === 1) return snap.refs.get(fuzzy[0]!.ref) ?? null;
  return null;
}

export class MemoryRecipeArchive {
  private readonly byOrigin = new Map<Origin, Recipe[]>();

  remember(origin: Origin, recipe: Recipe): void {
    const list = this.byOrigin.get(origin) ?? [];
    const stored: Recipe = { role: recipe.role, name: recipe.name, origin };
    if (recipe.landmark) stored.landmark = recipe.landmark;
    if (recipe.routePattern) stored.routePattern = recipe.routePattern;
    list.push(stored);
    this.byOrigin.set(origin, list);
  }

  lookup(origin: Origin, role: string, name: string): Recipe | null {
    const list = this.byOrigin.get(origin) ?? [];
    const hits = list.filter(
      (r) => r.role.toLowerCase() === role.toLowerCase() && r.name.toLowerCase() === name.toLowerCase(),
    );
    return hits.length === 1 ? hits[0]! : null;
  }
}
