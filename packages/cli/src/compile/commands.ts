import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  EXIT,
  checkCompiled,
  compileTrace,
  executeRecipe,
  type CompileContext,
  type Compiler,
  type ExecDeps,
  type Recipe,
  type RecipeStore,
  type TraceStore,
} from "@tyto/core";

export type CompileToolDeps = {
  /** Set (TYTO_COMPILE_DIR) only inside a compiler session. */
  dir: string | undefined;
  readStdin: () => Promise<string>;
};

type Io = { out: (line: string) => void; err: (line: string) => void };

const OUTPUT_LIMIT = 20_000;

function params(args: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 1) {
    const m = /^--(\w+)(?:=(.*))?$/s.exec(args[i] ?? "");
    if (!m?.[1]) continue;
    if (m[2] !== undefined) out[m[1]] = m[2];
    else {
      out[m[1]] = args[i + 1] ?? "";
      i += 1;
    }
  }
  return out;
}

async function context(dir: string): Promise<CompileContext> {
  return JSON.parse(await readFile(join(dir, "context.json"), "utf8")) as CompileContext;
}

/** The only command a compiler session may run. */
export async function compileTool(args: readonly string[], tool: CompileToolDeps, exec: ExecDeps, io: Io): Promise<number> {
  if (!tool.dir) {
    io.err("tyto compile-tool only runs inside `tyto compile`");
    return EXIT.usage;
  }
  const ctx = await context(tool.dir);
  const drafts = join(tool.dir, "drafts");
  const [sub, ...rest] = args;
  if (sub === "draft") {
    let raw: unknown;
    try {
      raw = JSON.parse(await tool.readStdin()) as unknown;
    } catch {
      io.out("draft rejected: stdin is not JSON");
      return EXIT.invalid;
    }
    const checked = checkCompiled(raw, ctx);
    if (!checked.ok) {
      io.out(`draft rejected:\n${checked.errors.map((e) => `- ${e}`).join("\n")}`);
      return EXIT.invalid;
    }
    await mkdir(drafts, { recursive: true, mode: 0o700 });
    const id = `d${(await readdir(drafts)).length + 1}`;
    await writeFile(join(drafts, `${id}.json`), JSON.stringify(checked.recipe, null, 2), { mode: 0o600 });
    io.out(`draft ${id} saved (${checked.recipe.steps.length} steps, params: ${Object.keys(checked.recipe.params).join(", ") || "none"})`);
    return EXIT.hit;
  }
  if (sub === "test") {
    const id = rest[0] ?? "";
    if (!/^d\d+$/.test(id)) {
      io.err("usage: tyto compile-tool test <draft id> [--param value ...]");
      return EXIT.usage;
    }
    const recipe = JSON.parse(await readFile(join(drafts, `${id}.json`), "utf8")) as Recipe;
    const outcome = await executeRecipe(recipe, params(rest.slice(1)), exec);
    if (outcome.kind === "hit") io.out(JSON.stringify({ hit: outcome.result }));
    else if (outcome.kind === "miss") io.out(JSON.stringify({ miss: outcome.miss, step: outcome.step }));
    else io.out(JSON.stringify({ error: outcome.message }));
    return outcome.kind === "hit" ? EXIT.hit : outcome.kind === "miss" ? EXIT.miss : outcome.code;
  }
  if (sub === "ab") {
    const hosts = [...new Set([...ctx.origins.map((o) => new URL(o).hostname), ...ctx.domains])];
    const res = await exec.runner.run(rest, {
      session: "tyto-compile",
      args: ["--allowed-domains", hosts.join(","), "--content-boundaries", "--action-policy", exec.paths.policy],
      env: { AGENT_BROWSER_CONFIG: exec.paths.config },
    });
    if (res.stdout) io.out(res.stdout.slice(0, OUTPUT_LIMIT));
    if (res.stderr) io.err(res.stderr.slice(0, 2000));
    return res.exitCode === 0 ? EXIT.hit : EXIT.miss;
  }
  io.err("usage: tyto compile-tool draft|test|ab …");
  return EXIT.usage;
}

export type CompileDeps = { traces: TraceStore; compiler: Compiler; store: RecipeStore };

export async function compile(args: readonly string[], deps: CompileDeps, io: Io): Promise<number> {
  const name = args[0];
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    io.err("usage: tyto compile <trace name>");
    return EXIT.usage;
  }
  const trace = await deps.traces.get(name);
  if (!trace) {
    io.err(`no trace named ${name} (record one with tyto learn ${name})`);
    return EXIT.usage;
  }
  io.out(`Compiling "${name}" (a one-time model session; usually under a minute)…`);
  const outcome = await compileTrace(trace, deps.compiler);
  if (!outcome.ok) {
    io.err(`compile failed:\n${outcome.errors.map((e) => `- ${e}`).join("\n")}`);
    return EXIT.invalid;
  }
  const recipe: Recipe = { ...outcome.recipe, name };
  await deps.store.save(recipe);
  const example = Object.entries(recipe.params)
    .map(([k, p]) => `--${k} ${JSON.stringify(p.default ?? p.example)}`)
    .join(" ");
  io.out(`Compiled "${name}" as a draft: ${recipe.intent}`);
  io.out(`  run:     tyto run ${name}${example ? ` ${example}` : ""}`);
  if (recipe.auth) io.out(`  approve: tyto recipes approve ${name}   (needed: this recipe uses your logins)`);
  return EXIT.hit;
}

export async function approve(args: readonly string[], store: RecipeStore, confirm: (q: string) => Promise<boolean>, io: Io): Promise<number> {
  const name = args[0];
  if (!name) {
    io.err("usage: tyto recipes approve <name> [--yes]");
    return EXIT.usage;
  }
  const recipe = await store.get(name);
  if (!recipe) {
    io.err(`unknown recipe: ${name}`);
    return EXIT.usage;
  }
  io.out(`${recipe.name}: ${recipe.intent}`);
  io.out(`  opens:  ${recipe.origins.join(", ")}${recipe.domains.length ? ` (+ ${recipe.domains.join(", ")})` : ""}`);
  io.out(`  logins: ${recipe.auth ? "YES — runs with your saved logins" : "no"}`);
  recipe.steps.forEach((s, i) => io.out(`  ${i + 1}. ${s[0] === "eval" ? `eval <${(s[1] ?? "").length} chars of read-only JavaScript>` : s.join(" ")}`));
  const ok = args.includes("--yes") || (await confirm(`Approve ${name}? [y/N] `));
  if (!ok) {
    io.err("not approved");
    return EXIT.usage;
  }
  await store.save({ ...recipe, status: "approved" });
  io.out(`approved ${name}`);
  return EXIT.hit;
}
