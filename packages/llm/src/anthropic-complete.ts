import type { CompleteRequest, CompleteResponse, InjectionGuard, ModelId, ModelPort, SecretRef } from "@tyto/core";
import { asRecord, joinPath, requestJson } from "./http.ts";
import { resolveInject, userContent } from "./payload.ts";

export type AnthropicOptions = {
  baseUrl: URL;
  apiKey: SecretRef;
  model: ModelId;
  inject?: InjectionGuard;
};

export class AnthropicModel implements ModelPort {
  private readonly inject: InjectionGuard;

  constructor(private readonly opts: AnthropicOptions) {
    this.inject = resolveInject(opts.inject);
  }

  async complete(req: CompleteRequest): Promise<CompleteResponse> {
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    };
    if (this.opts.apiKey) headers["x-api-key"] = this.opts.apiKey;
    const { json, status } = await requestJson(joinPath(this.opts.baseUrl, "v1/messages"), {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.opts.model,
        max_tokens: 4096,
        system: req.system,
        messages: [{ role: "user", content: userContent(req, this.inject) }],
      }),
    });
    if (status === 404) throw new Error("model adapter: HTTP 404");
    return { text: anthropicText(json) };
  }
}

function anthropicText(payload: unknown): string {
  const content = asRecord(payload)?.content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content) {
    const rec = asRecord(item);
    if (rec?.type === "text" && typeof rec.text === "string") parts.push(rec.text);
  }
  return parts.join("");
}
