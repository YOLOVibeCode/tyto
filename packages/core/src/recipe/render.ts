import { TEMPLATE, type ParamValue, type Recipe } from "./types.ts";

export type RenderResult =
  | { ok: true; steps: string[][]; params: Record<string, ParamValue> }
  | { ok: false; error: string };

class RenderError extends Error {}

function resolveParams(recipe: Recipe, input: Readonly<Record<string, string>>): Record<string, ParamValue> {
  for (const k of Object.keys(input)) if (!(k in recipe.params)) throw new RenderError(`unknown param ${k}`);
  const out: Record<string, ParamValue> = {};
  for (const [name, spec] of Object.entries(recipe.params)) {
    const raw = input[name] ?? spec.default;
    if (raw === undefined) throw new RenderError(`missing param ${name}`);
    switch (spec.type) {
      case "string":
        out[name] = raw;
        break;
      case "int":
        if (!/^-?\d+$/.test(raw)) throw new RenderError(`param ${name} must be an integer`);
        out[name] = Number.parseInt(raw, 10);
        break;
      case "enum":
        if (!spec.values?.includes(raw)) throw new RenderError(`param ${name} must be one of ${spec.values?.join(", ") ?? ""}`);
        out[name] = raw;
        break;
      default: {
        const never: never = spec.type;
        throw new RenderError(`unknown param type ${String(never)}`);
      }
    }
  }
  return out;
}

function inOrigins(url: string, origins: readonly string[]): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "https:" || u.protocol === "http:") && origins.includes(u.origin);
  } catch {
    return false;
  }
}

function applyFilter(value: string, filter: string | undefined, origins: readonly string[]): string {
  switch (filter) {
    case undefined:
      return value;
    case "lower":
      return value.toLowerCase();
    case "underscore":
      return value.replace(/ /g, "_");
    case "path":
      return value.split("/").map(encodeURIComponent).join("/");
    case "url":
      if (!inOrigins(value, origins)) throw new RenderError("url param is outside the recipe's origins");
      return value;
    default:
      throw new RenderError(`unknown filter ${filter}`);
  }
}

function renderArg(arg: string, params: Record<string, ParamValue>, origins: readonly string[]): string {
  if (!arg.includes("{{")) return arg;
  const out = arg.replace(TEMPLATE, (_m, name: string, filter: string | undefined) => {
    const v = params[name];
    if (v === undefined) throw new RenderError(`template uses unknown param ${name}`);
    return applyFilter(String(v), filter, origins);
  });
  if (out.startsWith("-")) throw new RenderError("a param value may not start an argument with '-'");
  return out;
}

function utf8Base64(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Wrap eval code so it reads `params` from a JSON literal; values are never pasted into code. */
export function evalWithParams(code: string, params: Record<string, ParamValue>): string {
  return `(function (params) { return eval(${JSON.stringify(code)}); })(JSON.parse(${JSON.stringify(JSON.stringify(params))}))`;
}

export function renderRecipe(recipe: Recipe, input: Readonly<Record<string, string>>): RenderResult {
  try {
    const params = resolveParams(recipe, input);
    const steps = recipe.steps.map((step) => {
      if (step[0] === "eval") return ["eval", "-b", utf8Base64(evalWithParams(step[1] ?? "", params))];
      const rendered = step.map((arg) => renderArg(arg, params, recipe.origins));
      if (rendered[0] === "open" && !inOrigins(rendered[1] ?? "", recipe.origins)) {
        throw new RenderError("rendered URL is outside the recipe's origins");
      }
      return rendered;
    });
    return { ok: true, steps, params };
  } catch (e) {
    if (e instanceof RenderError) return { ok: false, error: e.message };
    throw e;
  }
}
