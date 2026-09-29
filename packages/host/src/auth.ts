import { timingSafeEqual } from "node:crypto";
import type { TokenScope } from "@tyto/protocol";

/** Compare bearer tokens in constant time. Never log `header`. */
export function bearerMatches(header: string | undefined, expected: string): boolean {
  if (!header || !expected) return false;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  const got = m?.[1];
  if (!got) return false;
  return secretEqual(got, expected);
}

/** HttpOnly cookie set by the one-time Perch link. Never log `header`. */
export function cookieTokenMatches(header: string | undefined, expected: string): boolean {
  if (!header || !expected) return false;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== "tyto_at") continue;
    let got = trimmed.slice(eq + 1);
    try {
      got = decodeURIComponent(got);
    } catch {
      return false;
    }
    return secretEqual(got, expected);
  }
  return false;
}

export type HostTokens = { power: string; safe: string };

/**
 * Map credentials to a scope. The cookie only ever carries the safe token;
 * the power token is accepted as a Bearer header only.
 */
export function authorizeScope(
  authorization: string | undefined,
  cookie: string | undefined,
  tokens: HostTokens,
): TokenScope | null {
  if (bearerMatches(authorization, tokens.power)) return "power";
  if (bearerMatches(authorization, tokens.safe)) return "safe";
  if (cookieTokenMatches(cookie, tokens.safe)) return "safe";
  return null;
}

function secretEqual(got: string, expected: string): boolean {
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function headerValue(raw: string | string[] | undefined): string | undefined {
  if (Array.isArray(raw)) return raw[0];
  return raw;
}
