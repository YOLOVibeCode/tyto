export interface JsReader {
  evaluateJson<T>(expression: string): Promise<T | null>;
}
