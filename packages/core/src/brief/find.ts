export type FindResult = { count: number; hits: string[] };

/** Lines of page text containing every word (case-insensitive), each with the next two lines as context. */
export function findLines(pageText: string, query: string, max = 8): FindResult {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lines = pageText.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const hits: string[] = [];
  let count = 0;
  if (!terms.length) return { count, hits };
  lines.forEach((line, i) => {
    const low = line.toLowerCase();
    if (!terms.every((t) => low.includes(t))) return;
    count += 1;
    if (hits.length < max) hits.push(lines.slice(i, i + 3).join(" ⏎ ").slice(0, 300));
  });
  return { count, hits };
}
