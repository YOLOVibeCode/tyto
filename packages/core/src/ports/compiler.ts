/** What the compiler's tools may touch: the trace's sites only. */
export type CompileContext = { name: string; origins: readonly string[]; domains: readonly string[] };

export type CompileRequest = { system: string; prompt: string; context: CompileContext };

/** A model session that may only run `tyto compile-tool`. Returns the model's final message. */
export interface Compiler {
  run(req: CompileRequest): Promise<string>;
}
