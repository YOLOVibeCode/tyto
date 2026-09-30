import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ClaudeCodeCompiler } from "../src/index.ts";

const FAKE = fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url));
const REQUEST = { system: "CARD", prompt: "PROMPT", context: { name: "wiki-status", origins: ["https://en.wikipedia.org"], domains: [] } };

async function setup(env: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), "tyto-compile-"));
  const log = join(root, "claude.log");
  const compiler = new ClaudeCodeCompiler({
    claudeBin: FAKE,
    tytoBin: "/opt/tyto/bin/tyto.mjs",
    workRoot: join(root, "work"),
    baseEnv: { ...process.env, ANTHROPIC_API_KEY: "sk-ant-should-be-removed-0000", FAKE_CLAUDE_LOG: log, ...env },
  });
  const calls = async () => (await readFile(log, "utf8")).trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
  return { compiler, calls };
}

describe("ClaudeCodeCompiler", () => {
  it("claude runs with only Bash(tyto compile-tool:*) allowed and without ANTHROPIC_API_KEY", async () => {
    const { compiler, calls } = await setup();
    await compiler.run(REQUEST);
    const [call] = await calls();
    const argv = call?.argv as string[];
    expect(call?.hasApiKey).toBe(false);
    expect(argv.slice(argv.indexOf("--allowedTools"), argv.indexOf("--allowedTools") + 2)).toEqual(["--allowedTools", "Bash(tyto compile-tool:*)"]);
    for (const denied of ["Write", "Edit", "WebFetch", "WebSearch", "Task"]) expect(argv).toContain(denied);
    expect(argv).toContain("--strict-mcp-config");
    expect(argv.slice(0, 2)).toEqual(["-p", "PROMPT"]);
    expect(argv[argv.indexOf("--append-system-prompt") + 1]).toBe("CARD");
  });

  it("puts a tyto shim on PATH and sets TYTO_COMPILE_DIR with the compile context", async () => {
    const { compiler, calls } = await setup();
    await compiler.run(REQUEST);
    const [call] = await calls();
    const dir = String(call?.compileDir);
    expect(call?.cwd).toBe(await import("node:fs/promises").then((fs) => fs.realpath(dir)));
    expect(String(call?.path).split(":")[0]).toBe(join(dir, "bin"));
    expect(call?.context).toEqual({ name: "wiki-status", origins: ["https://en.wikipedia.org"], domains: [] });
    const shim = await readFile(join(dir, "bin", "tyto"), "utf8");
    expect(shim).toContain("/opt/tyto/bin/tyto.mjs");
    expect((await stat(join(dir, "bin", "tyto"))).mode & 0o111).not.toBe(0);
  });

  it("returns the final message text", async () => {
    const { compiler } = await setup();
    expect(await compiler.run(REQUEST)).toBe('```json\n{"name":"x"}\n```');
  });

  it("a failed claude run is an error", async () => {
    const { compiler } = await setup({ FAKE_CLAUDE_MODE: "fail" });
    await expect(compiler.run(REQUEST)).rejects.toThrow(/compiler/);
  });
});
