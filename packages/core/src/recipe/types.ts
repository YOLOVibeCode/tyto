export type ParamType = "string" | "int" | "enum";

export type ParamSpec = {
  type: ParamType;
  description: string;
  example: string;
  default?: string;
  values?: readonly string[];
};

/** One agent-browser command as an argv array, without `--session`. */
export type Step = readonly string[];

export type VerifyRule = {
  required: readonly string[];
  /** field → regex; `{{param}}` is replaced by the regex-escaped param value. */
  match: Readonly<Record<string, string>>;
};

export type RegressionCase = {
  params: Readonly<Record<string, string>>;
  expect: Readonly<Record<string, unknown>>;
};

export type RecipeStatus = "draft" | "approved";

export type Recipe = {
  name: string;
  version: 1;
  status: RecipeStatus;
  /** Needs the user's saved logins; runs only when approved. */
  auth: boolean;
  intent: string;
  examples: readonly string[];
  /** Origins the recipe may open, e.g. "https://github.com". */
  origins: readonly string[];
  params: Readonly<Record<string, ParamSpec>>;
  steps: readonly Step[];
  verify: VerifyRule;
  regression: readonly RegressionCase[];
};

export type ParamValue = string | number;

/** `{{name}}` or `{{name|filter}}`. */
export const TEMPLATE = /\{\{\s*(\w+)(?:\s*\|\s*(\w+))?\s*\}\}/g;
