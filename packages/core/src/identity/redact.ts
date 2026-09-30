import type { CompleteRequest } from "../types.ts";
import type { Redactor } from "../ports/redactor.ts";

const KEYED_SECRET = /(["']?(?:token|access_token|refresh_token|secret|password|passwd|authorization|api[_-]?key|session|sid)["']?\s*[:=]\s*["']?)([^"'&,}\s]{4,})/gi;

function redactLine(text: string): string {
  return text
    .replace(/\b(Set-Cookie|Cookie)\s*[:=]\s*[^\r\n]+/gi, "$1: [REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [REDACTED]")
    .replace(/sk-(?:ant-|proj-)?[A-Za-z0-9_\-]{16,}/g, "[REDACTED]")
    .replace(KEYED_SECRET, "$1[REDACTED]");
}

export class SecretRedactor implements Redactor {
  safe(text: string): string {
    return redactLine(text);
  }

  prompt(req: CompleteRequest): CompleteRequest {
    return {
      system: this.safe(req.system),
      user: this.safe(req.user),
      ...(req.page ? { page: { kind: "untrusted" as const, text: this.safe(req.page.text) } } : {}),
    };
  }
}
