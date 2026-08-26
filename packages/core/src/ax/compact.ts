import type { AxNode, AxSnapshot, Origin, RecipeHit, RefEntry } from "../types.ts";

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

export function compactAx(
  nodes: AxNode[],
  opts: { generation: number; origin: Origin; url: string; title: string; refStart?: number },
): AxSnapshot {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const root = nodes.find((n) => !n.parentId) ?? nodes[0];
  const refs = new Map<string, RefEntry>();
  const recipes: RecipeHit[] = [];
  const lines: string[] = [];
  let next = opts.refStart ?? 1;
  let links = 0;

  const walk = (node: AxNode | undefined, depth: number) => {
    if (!node) return;
    const kids = node.childIds ?? [];
    if (node.ignored) {
      for (const id of kids) walk(byId.get(id), depth);
      return;
    }
    const role = String(node.role?.value ?? "unknown").toLowerCase();
    const name = String(node.name?.value ?? "").trim();
    const backendNodeId = node.backendDOMNodeId;
    const isInteractive = INTERACTIVE.has(role) && !!name && typeof backendNodeId === "number";

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
      (role === "statictext" && name.length > 0 && name.length < 180);

    if (keep && (name || isInteractive)) {
      let tag = "";
      if (isInteractive && next <= 80 && typeof backendNodeId === "number") {
        const ref = `ref_${next++}`;
        const entry = { ref, role, name, backendNodeId };
        refs.set(ref, entry);
        recipes.push({ role, name, ref, backendNodeId, origin: opts.origin });
        tag = `[${ref}] `;
      }
      const pad = "  ".repeat(Math.min(depth, 6));
      lines.push(`${pad}${tag}${role}${name ? ` "${name}"` : ""}`);
    }

    for (const id of kids) walk(byId.get(id), depth + (keep ? 1 : 0));
  };

  walk(root, 0);
  let tree = lines.join("\n");
  if (tree.length > 14_000) tree = tree.slice(0, 14_000) + "\n…(truncated)";
  return {
    generation: opts.generation,
    origin: opts.origin,
    url: opts.url,
    title: opts.title,
    tree,
    refs,
    recipes,
  };
}
