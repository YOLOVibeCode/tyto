/** Accept `e12` where agent-browser expects `@e12` (small models often drop the @). */
export function normalizeRefs(argv: readonly string[]): string[] {
  return argv.map((a) => (/^e\d+$/.test(a) ? `@${a}` : a));
}
