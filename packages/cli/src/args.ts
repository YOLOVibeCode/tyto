export class UsageError extends Error {}

/** `--name value` / `--name=value` pairs. */
export function parseParams(args: readonly string[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    const m = /^--(\w+)(?:=(.*))?$/s.exec(arg);
    if (!m?.[1]) throw new UsageError(`expected --param value, got ${arg}`);
    if (m[2] !== undefined) params[m[1]] = m[2];
    else {
      const value = args[i + 1];
      if (value === undefined) throw new UsageError(`--${m[1]} needs a value`);
      params[m[1]] = value;
      i += 1;
    }
  }
  return params;
}

export function subset(expected: Readonly<Record<string, unknown>>, actual: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([k, v]) => JSON.stringify(actual[k]) === JSON.stringify(v));
}

export function asStrings(params: Readonly<Record<string, string | number>>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]));
}

export function paramFlags(params: Readonly<Record<string, string | number>>): string {
  return Object.entries(params)
    .map(([k, v]) => `--${k} ${JSON.stringify(String(v))}`)
    .join(" ");
}
