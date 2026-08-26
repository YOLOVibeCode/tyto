import type { CompleteRequest, CompleteResponse, InjectionGuard, ModelId, ModelPort, SecretRef } from "@tyto/core";
import { asRecord, bearerHeaders, joinPath, requestJson } from "./http.ts";
import { openaiMessages, resolveInject } from "./payload.ts";

export type OpenAiCompatOptions = {
  baseUrl: URL;
  apiKey: SecretRef;
  model: ModelId;
  inject?: InjectionGuard;
};

export class OpenAiCompatModel implements ModelPort {
  private readonly inject: InjectionGuard;

  constructor(private readonly opts: OpenAiCompatOptions) {
    this.inject = resolveInject(opts.inject);
  }

  async complete(req: CompleteRequest): Promise<CompleteResponse> {
    const { json, status } = await requestJson(joinPath(this.opts.baseUrl, "chat/completions"), {
      method: "POST",
      headers: { ...bearerHeaders(this.opts.apiKey), "content-type": "application/json" },
      body: JSON.stringify({ model: this.opts.model, messages: openaiMessages(req, this.inject) }),
    });
    if (status === 404) throw new Error("model adapter: HTTP 404");
    return { text: openaiText(json) };
  }
}

function openaiText(payload: unknown): string {
  const choices = asRecord(payload)?.choices;
  if (!Array.isArray(choices)) return "";
  const first = asRecord(choices[0]);
  const content = asRecord(first?.message)?.content;
  return typeof content === "string" ? content : "";
}
