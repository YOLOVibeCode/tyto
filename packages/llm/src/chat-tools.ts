import { asRecord, bearerHeaders, joinPath, requestJson } from "./http.ts";

export type ChatOptions = { baseUrl: URL; apiKey: string; model: string; timeoutMs?: number };

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: unknown[] }
  | { role: "tool"; content: string; tool_call_id: string };

export type ToolSpec = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ToolCall = { id: string; name: string; arguments: string };

export type ChatTurn = { content: string; toolCalls: ToolCall[]; message: ChatMessage };

/** One OpenAI-compatible chat completion with tools. No vendor SDK; any compatible endpoint (Ollama, proxies). */
export async function chatWithTools(opts: ChatOptions, messages: readonly ChatMessage[], tools: readonly ToolSpec[]): Promise<ChatTurn> {
  const { json } = await requestJson(joinPath(opts.baseUrl, "chat/completions"), {
    method: "POST",
    headers: { ...bearerHeaders(opts.apiKey), "content-type": "application/json" },
    body: JSON.stringify({ model: opts.model, messages, ...(tools.length ? { tools } : {}), temperature: 0 }),
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  });
  const choices = asRecord(json)?.choices;
  const msg = Array.isArray(choices) ? asRecord(asRecord(choices[0])?.message) : undefined;
  const content = typeof msg?.content === "string" ? msg.content : "";
  const raw = Array.isArray(msg?.tool_calls) ? msg.tool_calls : [];
  const toolCalls: ToolCall[] = raw.map((c, i) => {
    const call = asRecord(c);
    const fn = asRecord(call?.function);
    const args = fn?.arguments;
    return {
      id: typeof call?.id === "string" ? call.id : `call_${i}`,
      name: typeof fn?.name === "string" ? fn.name : "",
      arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
    };
  });
  const message: ChatMessage = raw.length ? { role: "assistant", content, tool_calls: raw } : { role: "assistant", content };
  return { content, toolCalls, message };
}
