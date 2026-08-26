import type { ModelCatalog, ModelId, SecretRef } from "@tyto/core";
import { asRecord, bearerHeaders, joinPath, requestJson } from "./http.ts";

export class OpenAiCatalog implements ModelCatalog {
  async list(baseUrl: URL, apiKey: SecretRef): Promise<ModelId[]> {
    const { status, json } = await requestJson(joinPath(baseUrl, "models"), {
      method: "GET",
      headers: bearerHeaders(apiKey),
    });
    if (status === 404) return [];
    return idsFromList(json);
  }
}

function idsFromList(payload: unknown): ModelId[] {
  const data = asRecord(payload)?.data;
  if (!Array.isArray(data)) return [];
  const out: ModelId[] = [];
  for (const item of data) {
    const id = asRecord(item)?.id;
    if (typeof id === "string") out.push(id);
  }
  return out;
}
