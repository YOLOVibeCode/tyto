import { TEMPLATE, type ParamValue, type VerifyRule } from "./types.ts";

export type VerifyOutcome = { hit: true; result: Record<string, unknown> } | { hit: false; miss: string };

const MAX_FIELD = 65_536;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

/** Check the final eval result against the recipe's rule. A miss is safe; a wrong hit is not. */
export function verifyResult(raw: unknown, rule: VerifyRule, params: Readonly<Record<string, ParamValue>>): VerifyOutcome {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return { hit: false, miss: "final eval did not return JSON" };
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { hit: false, miss: "final eval did not return an object" };
  }
  const result = value as Record<string, unknown>;
  for (const k of rule.required) if (isEmpty(result[k])) return { hit: false, miss: `required field empty: ${k}` };
  for (const [k, pattern] of Object.entries(rule.match)) {
    const source = pattern.replace(TEMPLATE, (_m, name: string) => escapeRegExp(String(params[name] ?? "")));
    let re: RegExp;
    try {
      re = new RegExp(source);
    } catch {
      return { hit: false, miss: `invalid match pattern for ${k}` };
    }
    const v = result[k];
    const text = (typeof v === "string" ? v : JSON.stringify(v) ?? "").slice(0, MAX_FIELD);
    if (!re.test(text)) return { hit: false, miss: `field ${k} does not match ${source}` };
  }
  return { hit: true, result };
}
