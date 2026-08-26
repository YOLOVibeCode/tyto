import type { DocShape, DocStats } from "../types.ts";

const SHELL_RE =
  /jump to content|enable javascript|you need to enable javascript|loading\.\.\.|id=["']root["']|id=["']app["']/i;

export function classifyStats(input: {
  textLen: number;
  elements: number;
  tables: number;
  mainLen: number;
  axNodes: number;
  textStart?: string;
  htmlHead?: string;
}): DocStats {
  const blob = `${input.textStart ?? ""} ${input.htmlHead ?? ""}`;
  const shellMarker = SHELL_RE.test(blob);
  const looksShell = shellMarker || (input.textLen < 3500 && input.mainLen < 1200 && input.tables < 3);
  const shape: DocShape = looksShell ? "shell" : "static";
  return { ...input, shape, shellMarker };
}

export function classifyAfter(before: DocStats, after: DocStats): DocShape {
  if (after.shellMarker && after.tables < 3 && after.mainLen < 4000) return "shell";
  const grew =
    after.textLen > before.textLen + 1500 ||
    after.mainLen > before.mainLen + 800 ||
    after.tables > before.tables + 2;
  const axBump = after.axNodes > before.axNodes + 10;
  if (grew && !after.shellMarker) return "injected";
  if (axBump && !after.shellMarker && after.mainLen > before.mainLen + 800) return "injected";
  if (after.shape !== "shell") return after.shape;
  return "shell";
}

/** Tiny AX growth alone must not flip shell → injected. */
export function axBumpIsInjected(before: number, after: number): boolean {
  return after >= before + 10;
}
