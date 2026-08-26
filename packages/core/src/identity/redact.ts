import type { CompleteRequest, TapeEvent } from "../types.ts";
import type { Redactor } from "../ports/redactor.ts";

function redactLine(text: string): string {
  return text
    .replace(/\b(Set-Cookie|Cookie)\s*[:=]\s*[^\r\n]+/gi, "$1: [REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [REDACTED]")
    .replace(/sk-(?:ant-|proj-)?[A-Za-z0-9_\-]{16,}/g, "[REDACTED]");
}

export class SecretRedactor implements Redactor {
  safe(text: string): string {
    return redactLine(text);
  }

  tape(event: TapeEvent): TapeEvent {
    return { ...event, detail: this.safe(event.detail) };
  }

  prompt(req: CompleteRequest): CompleteRequest {
    return {
      system: this.safe(req.system),
      user: this.safe(req.user),
      ...(req.page ? { page: { kind: "untrusted" as const, text: this.safe(req.page.text) } } : {}),
    };
  }
}
