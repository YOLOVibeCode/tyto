import type { Recipe, Step } from "./types.ts";

const ALLOWED = new Set([
  "open", "wait", "find", "click", "dblclick", "fill", "type", "select", "check", "uncheck", "hover", "press", "scroll", "get", "eval",
]);

/** Read-only backstop for eval code. The approval gate is the real control for logged-in recipes. */
const EVAL_FORBIDDEN: ReadonlyArray<[RegExp, string]> = [
  [/\bfetch\s*[(]/, "fetch"],
  [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
  [/\bsendBeacon\b/, "sendBeacon"],
  [/\bWebSocket\b/, "WebSocket"],
  [/\bimport\s*\(/, "import("],
  [/document\s*\.\s*cookie/, "document.cookie"],
  [/\blocalStorage\b/, "localStorage"],
  [/\bsessionStorage\b/, "sessionStorage"],
  [/\blocation(?:\s*\.\s*href)?\s*=(?!=)/, "location assignment"],
  [/\blocation\s*\.\s*(?:assign|replace)\s*\(/, "location.assign/replace"],
  [/\bwindow\s*\.\s*open\s*\(/, "window.open("],
  [/\.submit\s*\(/, ".submit("],
];

const SENSITIVE =
  /(?:^|[^a-z])(?:pass(?:word|wd|code|phrase)?|token|secret|otp|one[-_ ]?time|cvv|cvc|ssn|pin)(?:[^a-z]|$)|cc-(?:number|csc|exp)|card/i;

const URL_PARAM_ONLY = /^\{\{\s*\w+\s*\|\s*url\s*\}\}$/;

function opensAllowedOrigin(url: string, origins: readonly string[]): boolean {
  if (URL_PARAM_ONLY.test(url)) return true; // checked against origins at render time
  return origins.some((o) => url === o || url.startsWith(`${o}/`) || url.startsWith(`${o}?`) || url.startsWith(`${o}#`));
}

function sensitiveLocator(step: Step): string | null {
  const cmd = step[0];
  if (cmd === "fill" || cmd === "type") return SENSITIVE.test(step[1] ?? "") ? (step[1] ?? "") : null;
  if (cmd === "find") {
    const action = step.findIndex((a, i) => i > 0 && (a === "fill" || a === "type"));
    if (action < 0) return null;
    const locator = [...step.slice(1, action), ...step.slice(action + 2)].join(" ");
    return SENSITIVE.test(locator) ? locator : null;
  }
  return null;
}

/** Security rules. A recipe with any problem must not be stored or run. */
export function lintRecipe(recipe: Recipe): string[] {
  const problems: string[] = [];
  recipe.steps.forEach((step, i) => {
    const at = `step ${i + 1}`;
    const cmd = step[0] ?? "";
    if (!ALLOWED.has(cmd)) problems.push(`${at}: command "${cmd}" is not allowed in recipes`);
    for (const arg of step) {
      const ref = /(?:^|[^\w])(@e\d+)\b/.exec(arg);
      if (ref) problems.push(`${at}: uses snapshot ref ${ref[1]}, which only exists in one snapshot`);
      if (arg.includes(":nth-of-type(") && arg.includes("{{"))
        problems.push(`${at}: :nth-of-type built from a param counts mixed siblings; count the items themselves`);
    }
    if (cmd === "eval") {
      const code = step[1] ?? "";
      if (step.length !== 2) problems.push(`${at}: eval takes exactly one code argument`);
      if (code.includes("{{")) problems.push(`${at}: eval code must read params, not use {{…}} templates`);
      for (const [re, label] of EVAL_FORBIDDEN) if (re.test(code)) problems.push(`${at}: eval code uses ${label}`);
    }
    if (cmd === "open" && !opensAllowedOrigin(step[1] ?? "", recipe.origins)) {
      problems.push(`${at}: opens a URL outside the recipe's origins`);
    }
    const sensitive = sensitiveLocator(step);
    if (sensitive !== null) problems.push(`${at}: fills a password, token, OTP, or card field (${sensitive}); use agent-browser auth`);
  });
  return problems;
}
