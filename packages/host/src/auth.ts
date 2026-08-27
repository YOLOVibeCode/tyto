import { timingSafeEqual } from "node:crypto";

/** Compare bearer tokens in constant time. Never log `header`. */
export function bearerMatches(header: string | undefined, expected: string): boolean {
  if (!header || !expected) return false;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  const got = m?.[1];
  if (!got) return false;
  return secretEqual(got, expected);
}

/** HttpOnly cookie set on GET /. Never log `header`. */
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

export function requestAuthorized(
  authorization: string | undefined,
  cookie: string | undefined,
  token: string,
): boolean {
  return bearerMatches(authorization, token) || cookieTokenMatches(cookie, token);
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
