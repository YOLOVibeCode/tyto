/** Pull the recipe JSON out of the compiler's final message (a ```json block, or the outermost {...}). */
export function extractRecipeJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [fenced?.[1], text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)];
  for (const c of candidates) {
    if (!c || !c.trim().startsWith("{")) continue;
    try {
      return JSON.parse(c) as unknown;
    } catch {
      continue;
    }
  }
  return null;
}
