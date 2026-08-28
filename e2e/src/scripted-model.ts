/**
 * Loopback server implementing the OpenAI-compat API for deterministic e2e tests.
 * Returns canned plans keyed by which fixture URL appears in the prompt.
 * Zero API keys needed; never makes real network calls.
 */
import { createServer, type Server } from "node:http";

/** A single canned response keyed by a URL substring. */
type ScriptEntry = {
  urlPattern: string;
  plan: {
    rationale: string;
    anchors: Array<{ id: string; role: string; name: string }>;
    steps: Array<{ op: string; reason?: string; query?: string }>;
  };
};

const DEFAULT_PLAN = {
  rationale: "Default scripted plan: extract answer",
  anchors: [],
  steps: [{ op: "extract", query: "main content" }, { op: "done", reason: "extracted" }],
};

const SCRIPTS: ScriptEntry[] = [
  {
    urlPattern: "/search.html",
    plan: {
      rationale: "Fill search and submit",
      anchors: [{ id: "q", role: "searchbox", name: "Query" }],
      steps: [
        { op: "fill", role: "searchbox", name: "Query", text: "fixture query" } as never,
        { op: "click", role: "button", name: "Search" } as never,
        { op: "done", reason: "search submitted" },
      ],
    },
  },
  {
    urlPattern: "/result.html",
    plan: {
      rationale: "Extract the result answer",
      anchors: [],
      steps: [{ op: "extract", query: "The answer" }, { op: "done", reason: "extracted" }],
    },
  },
];

function planForPrompt(prompt: string): object {
  for (const entry of SCRIPTS) {
    if (prompt.includes(entry.urlPattern)) return entry.plan;
  }
  return DEFAULT_PLAN;
}

/** Parse the conversation to extract the user's last message text. */
function promptFromMessages(messages: Array<{ role: string; content: string }>): string {
  return messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");
}

export type ScriptedModelServer = {
  readonly port: number;
  readonly url: string;
  readonly baseUrl: string;
  /** Raw request bodies received by POST /v1/chat/completions (for redaction grep). */
  readonly prompts: string[];
  close(): Promise<void>;
};

export async function startScriptedModel(): Promise<ScriptedModelServer> {
  const prompts: string[] = [];
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          object: "list",
          data: [
            { id: "scripted-model", object: "model", created: 0, owned_by: "tyto-e2e" },
          ],
        }),
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      let body = "";
      req.on("data", (chunk) => {
        body += String(chunk);
      });
      req.on("end", () => {
        prompts.push(body);
        let parsed: { messages?: Array<{ role: string; content: string }> } = {};
        try {
          parsed = JSON.parse(body) as typeof parsed;
        } catch {
          /* ignore */
        }
        const prompt = promptFromMessages(parsed.messages ?? []);
        const plan = planForPrompt(prompt);
        const content = JSON.stringify(plan);
        const response = {
          id: "chatcmpl-scripted",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "scripted-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(response));
      });
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("scripted model server failed to start");
  const port = addr.port;
  const baseUrl = `http://127.0.0.1:${port}/v1`;

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    baseUrl,
    prompts,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      }),
  };
}
