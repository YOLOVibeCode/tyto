import { createServer, type Server } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { OpenAiCompatCompiler } from "../src/index.ts";

const FAKE_TYTO = fileURLToPath(new URL("./fixtures/fake-tyto.mjs", import.meta.url));
const REQUEST = { system: "CARD", prompt: "PROMPT", context: { name: "wiki-status", origins: ["https://en.wikipedia.org"], domains: [] } };
let server: Server | null = null;

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

function call(id: string, args: unknown): unknown {
  return { id, type: "function", function: { name: "tyto_compile_tool", arguments: JSON.stringify(args) } };
}

/** Scripted OpenAI-compatible server: one reply per request, in order. */
async function model(replies: unknown[]): Promise<{ base: URL; requests: Array<{ messages: Array<Record<string, unknown>> }> }> {
  const requests: Array<{ messages: Array<Record<string, unknown>> }> = [];
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      requests.push(JSON.parse(raw) as { messages: Array<Record<string, unknown>> });
      const message = replies[Math.min(requests.length - 1, replies.length - 1)];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message }] }));
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  return { base: new URL(`http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/v1`), requests };
}

async function compiler(base: URL) {
  const root = await mkdtemp(join(tmpdir(), "tyto-oc-"));
  const log = join(root, "tyto.log");
  const c = new OpenAiCompatCompiler({
    baseUrl: base,
    apiKey: "",
    model: "local-model",
    tytoBin: FAKE_TYTO,
    nodePath: process.execPath,
    workRoot: join(root, "work"),
    baseEnv: { ...process.env, FAKE_TYTO_LOG: log },
  });
  const calls = async () => (await readFile(log, "utf8")).trim().split("\n").map((l) => JSON.parse(l) as { argv: string[]; stdin: string; dir: string | null });
  return { c, calls };
}

describe("OpenAiCompatCompiler", () => {
  it("the tool-call loop runs compile-tool calls and stops on the final recipe JSON", async () => {
    const { base, requests } = await model([
      { content: "", tool_calls: [call("c1", { args: ["draft"], stdin: '{"name":"wiki-status"}' })] },
      { content: "", tool_calls: [call("c2", { args: ["test", "d1", "--species", "Tiger"] })] },
      { content: '```json\n{"name":"wiki-status"}\n```' },
    ]);
    const { c, calls } = await compiler(base);
    const final = await c.run(REQUEST);
    expect(final).toContain('"name":"wiki-status"');
    const ran = await calls();
    expect(ran.map((r) => r.argv)).toEqual([["compile-tool", "draft"], ["compile-tool", "test", "d1", "--species", "Tiger"]]);
    expect(ran[0]?.stdin).toBe('{"name":"wiki-status"}');
    expect(ran[0]?.dir).toMatch(/wiki-status-/);
    expect(requests[0]?.messages.slice(0, 2)).toEqual([{ role: "system", content: "CARD" }, { role: "user", content: "PROMPT" }]);
    expect(JSON.stringify(requests[1]?.messages)).toContain("draft d1 saved");
  });

  it("tool calls run tyto compile-tool with an argv array, never a shell", async () => {
    const { base } = await model([
      { content: "", tool_calls: [call("c1", { args: ["test", "d1; touch /tmp/pwned", "$(id)"] })] },
      { content: "done" },
    ]);
    const { c, calls } = await compiler(base);
    await c.run(REQUEST);
    expect((await calls())[0]?.argv).toEqual(["compile-tool", "test", "d1; touch /tmp/pwned", "$(id)"]);
  });

  it("a string of args is split like a command line", async () => {
    const { base } = await model([{ content: "", tool_calls: [call("c1", { args: 'test d1 --species "Snowy owl"' })] }, { content: "done" }]);
    const { c, calls } = await compiler(base);
    await c.run(REQUEST);
    expect((await calls())[0]?.argv).toEqual(["compile-tool", "test", "d1", "--species", "Snowy owl"]);
  });

  it("gives up after the turn limit", async () => {
    const { base } = await model([{ content: "", tool_calls: [call("c1", { args: ["test", "d1"] })] }]);
    const root = await mkdtemp(join(tmpdir(), "tyto-oc-"));
    const c = new OpenAiCompatCompiler({ baseUrl: base, apiKey: "", model: "m", tytoBin: FAKE_TYTO, nodePath: process.execPath, workRoot: root, maxTurns: 3 });
    await expect(c.run(REQUEST)).rejects.toThrow(/turn limit/);
  });
});
