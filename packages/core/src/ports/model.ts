import type { CompleteRequest, CompleteResponse, ModelId, SecretRef } from "../types.ts";

export interface ModelPort {
  complete(req: CompleteRequest): Promise<CompleteResponse>;
}

export interface ModelCatalog {
  list(baseUrl: URL, apiKey: SecretRef): Promise<ModelId[]>;
}
