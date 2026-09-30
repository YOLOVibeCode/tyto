import type { ParamSpec, ParamType, Recipe, RecipeStatus, RegressionCase, Step, VerifyRule } from "./types.ts";

export type ParseResult = { ok: true; recipe: Recipe } | { ok: false; errors: string[] };

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PARAM_TYPES: readonly ParamType[] = ["string", "int", "enum"];
const STATUSES: readonly RecipeStatus[] = ["draft", "approved"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isOrigin(v: string): boolean {
  try {
    const u = new URL(v);
    return (u.protocol === "https:" || u.protocol === "http:") && u.origin === v;
  } catch {
    return false;
  }
}

function parseParam(name: string, v: unknown, errors: string[]): ParamSpec | null {
  if (!isRecord(v)) {
    errors.push(`param ${name}: must be an object`);
    return null;
  }
  const type = v.type;
  if (typeof type !== "string" || !PARAM_TYPES.includes(type as ParamType)) {
    errors.push(`param ${name}: type must be string, int, or enum`);
    return null;
  }
  if (typeof v.description !== "string" || typeof v.example !== "string") {
    errors.push(`param ${name}: description and example must be strings`);
    return null;
  }
  const spec: ParamSpec = { type: type as ParamType, description: v.description, example: v.example };
  if (v.default !== undefined) {
    if (typeof v.default !== "string") errors.push(`param ${name}: default must be a string`);
    else spec.default = v.default;
  }
  if (type === "enum") {
    if (!isStringArray(v.values) || v.values.length === 0) errors.push(`param ${name}: enum needs non-empty values`);
    else spec.values = v.values;
  }
  if (type === "int" && spec.default !== undefined && !/^-?\d+$/.test(spec.default)) {
    errors.push(`param ${name}: default is not an integer`);
  }
  if (type === "enum" && spec.default !== undefined && spec.values && !spec.values.includes(spec.default)) {
    errors.push(`param ${name}: default is not one of values`);
  }
  return spec;
}

function parseVerify(v: unknown, errors: string[]): VerifyRule {
  if (!isRecord(v)) {
    errors.push("verify must be an object");
    return { required: [], match: {} };
  }
  const required = v.required === undefined ? [] : v.required;
  if (!isStringArray(required)) errors.push("verify.required must be a string array");
  const match: Record<string, string> = {};
  if (v.match !== undefined) {
    if (!isRecord(v.match)) errors.push("verify.match must be an object");
    else
      for (const [k, pat] of Object.entries(v.match)) {
        if (typeof pat !== "string") errors.push(`verify.match.${k} must be a string`);
        else match[k] = pat;
      }
  }
  return { required: isStringArray(required) ? required : [], match };
}

function parseRegression(v: unknown, errors: string[]): RegressionCase[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) {
    errors.push("regression must be an array");
    return [];
  }
  const out: RegressionCase[] = [];
  for (const c of v) {
    if (!isRecord(c) || !isRecord(c.params) || !isRecord(c.expect)) {
      errors.push("regression cases need params and expect objects");
      continue;
    }
    const params: Record<string, string> = {};
    for (const [k, val] of Object.entries(c.params)) {
      if (typeof val !== "string") errors.push(`regression param ${k} must be a string`);
      else params[k] = val;
    }
    out.push({ params, expect: c.expect });
  }
  return out;
}

/** Structural validation. Security rules live in `lintRecipe`. */
export function parseRecipe(input: unknown): ParseResult {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["recipe must be a JSON object"] };

  const name = input.name;
  if (typeof name !== "string" || !NAME.test(name)) errors.push("name must be kebab-case");
  if (input.version !== 1) errors.push("version must be 1");
  const status = input.status ?? "draft";
  if (typeof status !== "string" || !STATUSES.includes(status as RecipeStatus)) errors.push("status must be draft or approved");
  const auth = input.auth ?? false;
  if (typeof auth !== "boolean") errors.push("auth must be a boolean");
  if (typeof input.intent !== "string" || input.intent.trim() === "") errors.push("intent must be a non-empty string");
  const examples = input.examples ?? [];
  if (!isStringArray(examples)) errors.push("examples must be a string array");
  const origins = input.origins;
  if (!isStringArray(origins) || origins.length === 0) errors.push("origins must be a non-empty string array");
  else for (const o of origins) if (!isOrigin(o)) errors.push(`origin ${o} must look like https://host[:port]`);

  const params: Record<string, ParamSpec> = {};
  if (input.params !== undefined) {
    if (!isRecord(input.params)) errors.push("params must be an object");
    else
      for (const [k, v] of Object.entries(input.params)) {
        if (!/^\w+$/.test(k)) errors.push(`param name ${k} must be a word`);
        const spec = parseParam(k, v, errors);
        if (spec) params[k] = spec;
      }
  }

  const steps: Step[] = [];
  if (!Array.isArray(input.steps) || input.steps.length === 0) errors.push("steps must be a non-empty array");
  else
    for (const s of input.steps) {
      if (!isStringArray(s) || s.length === 0) errors.push("each step must be a non-empty array of strings");
      else steps.push(s);
    }
  const last = steps.at(-1);
  if (!last || last[0] !== "eval" || last.length !== 2) errors.push('the last step must be ["eval", "<code>"]');

  const verify = parseVerify(input.verify, errors);
  const regression = parseRegression(input.regression, errors);

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    recipe: {
      name: name as string,
      version: 1,
      status: status as RecipeStatus,
      auth: auth as boolean,
      intent: input.intent as string,
      examples: examples as string[],
      origins: origins as string[],
      params,
      steps,
      verify,
      regression,
    },
  };
}
