import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CompileContext } from "@tyto/core";

/** A private folder per compile: context.json (sites the tools may touch) and a `tyto` shim for the model. */
export async function prepareWorkdir(workRoot: string, context: CompileContext, tytoBin: string, nodePath: string): Promise<string> {
  await mkdir(workRoot, { recursive: true, mode: 0o700 });
  const dir = await mkdtemp(join(workRoot, `${context.name}-`));
  await mkdir(join(dir, "bin"), { mode: 0o700 });
  await writeFile(join(dir, "context.json"), JSON.stringify(context), { mode: 0o600 });
  const shim = join(dir, "bin", "tyto");
  await writeFile(shim, `#!/bin/sh\nexec ${JSON.stringify(nodePath)} ${JSON.stringify(tytoBin)} "$@"\n`, { mode: 0o700 });
  await chmod(shim, 0o700);
  return dir;
}

/** Split a command line into argv (double and single quotes; no shell expansion). */
export function splitArgs(line: string): string[] {
  const out: string[] = [];
  const re = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g;
  for (const m of line.matchAll(re)) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : (m[2] ?? m[3] ?? ""));
  return out;
}
