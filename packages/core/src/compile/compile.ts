import type { Compiler } from "../ports/compiler.ts";
import type { Trace } from "../trace/types.ts";
import { COMPILER_CARD } from "./card.ts";
import { checkCompiled, type CheckResult } from "./check.ts";
import { extractRecipeJson } from "./extract.ts";
import { compilerPrompt } from "./prompt.ts";

export type CompileOutcome = CheckResult & { reply: string };

/** Trace → compiler session → checked draft recipe. */
export async function compileTrace(trace: Trace, compiler: Compiler, nonce: string = crypto.randomUUID()): Promise<CompileOutcome> {
  const reply = await compiler.run({
    system: COMPILER_CARD,
    prompt: compilerPrompt(trace, nonce),
    context: { name: trace.name, origins: trace.origins, domains: [] },
  });
  const raw = extractRecipeJson(reply);
  if (raw === null) return { ok: false, errors: ["the compiler did not return recipe JSON"], reply };
  return { ...checkCompiled(raw, trace), reply };
}
