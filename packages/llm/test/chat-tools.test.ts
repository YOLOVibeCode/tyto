import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { chatWithTools } from "../src/index.ts";

let server: Server | null = null;
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

async function mock(handler: (body: Record<string, unknown>) => { status?: number; delayMs?: number; json: unknown }): Promise<{ base: URL; bodies: Array<Record<string, unknown>> }> {
  const bodies: Array<Record<string, unknown>> = [];
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      bodies.push(body);
      const reply = handler(body);
      setTimeout(() => {
        res.writeHead(reply.status ?? 200, { "content-type": "application/json" });
        res.end(JSON.stringify(reply.json));
      }, reply.delayMs ?? 0);
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  return { base: new URL(`http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/v1`), bodies };
}

const TOOL = { type: "function" as const, function: { name: "tyto_compile_tool", description: "x", parameters: { type: "object", properties: {} } } };

describe("chatWithTools", () => {
  it("posts messages and tools and returns tool calls", async () => {
    const { base, bodies } = await mock(() => ({
      json: { choices: [{ message: { content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "tyto_compile_tool", arguments: '{"args":["test","d1"]}' } }] } }] },
    }));
    const out = await chatWithTools({ baseUrl: base, apiKey: "k", model: "m" }, [{ role: "user", content: "hi" }], [TOOL]);
    expect(out.toolCalls).toEqual([{ id: "c1", name: "tyto_compile_tool", arguments: '{"args":["test","d1"]}' }]);
    expect(bodies[0]).toMatchObject({ model: "m", tools: [TOOL], messages: [{ role: "user", content: "hi" }] });
  });

  it("returns the final content when the model stops calling tools", async () => {
    const { base } = await mock(() => ({ json: { choices: [{ message: { content: "done" } }] } }));
    expect(await chatWithTools({ baseUrl: base, apiKey: "", model: "m" }, [], [])).toEqual({ content: "done", toolCalls: [], message: { role: "assistant", content: "done" } });
  });

  it("the request timeout is configurable", async () => {
    const { base } = await mock(() => ({ delayMs: 300, json: { choices: [] } }));
    await expect(chatWithTools({ baseUrl: base, apiKey: "", model: "m", timeoutMs: 50 }, [], [])).rejects.toThrow();
  });
});
