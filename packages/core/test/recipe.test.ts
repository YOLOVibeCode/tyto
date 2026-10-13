import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { lintRecipe, parseRecipe, renderRecipe, verifyResult, type Recipe } from "../src/index.ts";

function base(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "github-release-info",
    version: 1,
    status: "draft",
    auth: false,
    intent: "Newest release tag and date for a GitHub repo.",
    examples: ["latest release of vercel-labs/agent-browser"],
    origins: ["https://github.com"],
    params: {
      repo: { type: "string", description: "owner/name", example: "vercel-labs/agent-browser" },
      n: { type: "int", description: "position, 1 = newest", example: "1", default: "1" },
    },
    steps: [
      ["open", "https://github.com/{{repo|path}}/releases"],
      ["wait", "--load", "load"],
      ["eval", "JSON.stringify({ tag: 'v' + params.n, repo: params.repo, url: 'https://github.com/' + params.repo })"],
    ],
    verify: { required: ["tag", "url"], match: { url: "github\\.com/{{repo}}" } },
    regression: [],
    ...overrides,
  };
}

function recipe(overrides: Record<string, unknown> = {}): Recipe {
  const parsed = parseRecipe(base(overrides));
  if (!parsed.ok) throw new Error(parsed.errors.join("; "));
  return parsed.recipe;
}

function lintOf(overrides: Record<string, unknown>): string[] {
  return lintRecipe(recipe(overrides));
}

function decodeEval(step: readonly string[]): string {
  expect(step.slice(0, 2)).toEqual(["eval", "-b"]);
  return new TextDecoder().decode(Uint8Array.from(atob(step[2] ?? ""), (c) => c.charCodeAt(0)));
}

describe("parseRecipe", () => {
  it("accepts a valid recipe and returns typed params", () => {
    const r = recipe();
    expect(r.params.n?.type).toBe("int");
    expect(r.params.repo?.default).toBeUndefined();
    expect(r.steps).toHaveLength(3);
  });

  it("accepts extra network domains and rejects malformed ones", () => {
    expect(recipe({ domains: ["github.githubassets.com", "*.githubusercontent.com"] }).domains).toEqual([
      "github.githubassets.com",
      "*.githubusercontent.com",
    ]);
    for (const bad of ["https://cdn.test", "cdn.test/path", "*", "a b.test"]) {
      expect(parseRecipe(base({ domains: [bad] })).ok, bad).toBe(false);
    }
  });

  it("rejects a recipe whose last step is not eval", () => {
    const parsed = parseRecipe(base({ steps: [["open", "https://github.com/"], ["wait", "--load", "load"]] }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.join(" ")).toMatch(/last step/i);
  });
});

describe("lintRecipe", () => {
  it("accepts the base recipe", () => {
    expect(lintOf({})).toEqual([]);
  });

  it("rejects {{ inside eval code", () => {
    const problems = lintOf({ steps: [["open", "https://github.com/"], ["eval", "JSON.stringify({ n: {{n}} })"]] });
    expect(problems.join(" ")).toMatch(/eval.*\{\{/i);
  });

  it("rejects commands outside the allowlist (cookies, storage, network, download, upload, auth, state, snapshot, screenshot)", () => {
    for (const cmd of ["cookies", "storage", "network", "download", "upload", "auth", "state", "snapshot", "screenshot"]) {
      const problems = lintOf({ steps: [["open", "https://github.com/"], [cmd, "x"], ["eval", "JSON.stringify({})"]] });
      expect(problems.join(" "), cmd).toMatch(new RegExp(`command.*${cmd}`, "i"));
    }
  });

  it("rejects @eN refs in steps", () => {
    const problems = lintOf({ steps: [["open", "https://github.com/"], ["click", "@e12"], ["eval", "JSON.stringify({})"]] });
    expect(problems.join(" ")).toMatch(/@e12/);
  });

  it("rejects an open URL whose origin is not in origins", () => {
    const problems = lintOf({ steps: [["open", "https://evil.test/x"], ["eval", "JSON.stringify({})"]] });
    expect(problems.join(" ")).toMatch(/origin/i);
  });

  it("rejects eval code using fetch, XMLHttpRequest, sendBeacon, WebSocket, import(, document.cookie, localStorage, sessionStorage, location assignment, or .submit(", () => {
    const bad = [
      "fetch('/x')",
      "new XMLHttpRequest()",
      "navigator.sendBeacon('/x')",
      "new WebSocket('wss://x')",
      "import('x')",
      "document.cookie",
      "localStorage.getItem('a')",
      "sessionStorage.length",
      "location = 'https://evil.test'",
      "location.href = 'https://evil.test'",
      "document.forms[0].submit()",
    ];
    for (const code of bad) {
      const problems = lintOf({ steps: [["open", "https://github.com/"], ["eval", `(() => { ${code}; return JSON.stringify({}); })()`]] });
      expect(problems.length, code).toBeGreaterThan(0);
    }
  });

  it("rejects fills whose locator looks like a password, token, OTP, or card field", () => {
    for (const locator of ["#password", "input[name=api_token]", "#otp-code", "input[autocomplete=cc-number]", "#card-number"]) {
      const problems = lintOf({ steps: [["open", "https://github.com/"], ["fill", locator, "{{repo}}"], ["eval", "JSON.stringify({})"]] });
      expect(problems.length, locator).toBeGreaterThan(0);
    }
    const viaFind = lintOf({ steps: [["open", "https://github.com/"], ["find", "label", "Password", "fill", "x"], ["eval", "JSON.stringify({})"]] });
    expect(viaFind.length).toBeGreaterThan(0);
  });

  it("rejects :nth-of-type selectors built from a param", () => {
    const problems = lintOf({ steps: [["open", "https://github.com/"], ["click", "tr.athing:nth-of-type({{n}}) a"], ["eval", "JSON.stringify({})"]] });
    expect(problems.join(" ")).toMatch(/nth-of-type/);
  });
});

describe("renderRecipe", () => {
  it("applies lower, underscore, path, and url filters", () => {
    const r = recipe({
      params: {
        q: { type: "string", description: "query", example: "Snowy Owl" },
        target: { type: "string", description: "page", example: "https://github.com/a" },
      },
      steps: [
        ["open", "{{target|url}}"],
        ["fill", "#q", "{{q|lower}}"],
        ["wait", "--url", "**/wiki/{{q|underscore}}"],
        ["open", "https://github.com/search/{{q|path}}"],
        ["eval", "JSON.stringify({})"],
      ],
      verify: { required: [], match: {} },
    });
    const out = renderRecipe(r, { q: "Snowy Owl/Tyto", target: "https://github.com/topics" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.steps[0]).toEqual(["open", "https://github.com/topics"]);
    expect(out.steps[1]).toEqual(["fill", "#q", "snowy owl/tyto"]);
    expect(out.steps[2]).toEqual(["wait", "--url", "**/wiki/Snowy_Owl/Tyto"]);
    expect(out.steps[3]).toEqual(["open", "https://github.com/search/Snowy%20Owl/Tyto"]);
  });

  it("fills defaults and rejects missing required params", () => {
    const ok = renderRecipe(recipe(), { repo: "vercel-labs/agent-browser" });
    expect(ok.ok && ok.params).toEqual({ repo: "vercel-labs/agent-browser", n: 1 });
    const missing = renderRecipe(recipe(), {});
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toMatch(/repo/);
  });

  it("rejects non-integer int params and values outside an enum", () => {
    expect(renderRecipe(recipe(), { repo: "a/b", n: "two" }).ok).toBe(false);
    const withEnum = recipe({
      params: { size: { type: "enum", description: "size", example: "medium", values: ["small", "medium", "large"] } },
      steps: [["open", "https://github.com/"], ["eval", "JSON.stringify({ size: params.size })"]],
      verify: { required: [], match: {} },
    });
    expect(renderRecipe(withEnum, { size: "medium" }).ok).toBe(true);
    expect(renderRecipe(withEnum, { size: "huge" }).ok).toBe(false);
  });

  it("rejects unknown params", () => {
    const out = renderRecipe(recipe(), { repo: "a/b", extra: "x" });
    expect(out.ok).toBe(false);
  });

  it('rejects a param value that would start an argv element with "-"', () => {
    const r = recipe({ steps: [["open", "https://github.com/"], ["fill", "#q", "{{repo}}"], ["eval", "JSON.stringify({})"]] });
    const out = renderRecipe(r, { repo: "--profile=/tmp/x" });
    expect(out.ok).toBe(false);
  });

  it("keeps rendered open URLs inside origins", () => {
    const r = recipe({
      params: { target: { type: "string", description: "page", example: "https://github.com/a" } },
      steps: [["open", "{{target|url}}"], ["eval", "JSON.stringify({})"]],
      verify: { required: [], match: {} },
    });
    expect(renderRecipe(r, { target: "https://evil.test/phish" }).ok).toBe(false);
    expect(renderRecipe(r, { target: "https://github.com.evil.test/" }).ok).toBe(false);
    expect(renderRecipe(recipe(), { repo: "../../evil.test" }).ok).toBe(true);
    const out = renderRecipe(recipe(), { repo: "../../evil.test" });
    if (out.ok) expect(new URL(out.steps[0]?.[1] ?? "").origin).toBe("https://github.com");
  });

  it("eval preamble carries params as JSON and survives quotes, backslashes, and </script>", () => {
    const tricky = `a'b"c\\d</script><script>alert(1)</script>\`\${x}`;
    const out = renderRecipe(recipe(), { repo: tricky });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const code = decodeEval(out.steps[2] ?? []);
    const value = runInNewContext(code, {}) as string;
    expect(JSON.parse(value)).toEqual({ tag: "v1", repo: tricky, url: `https://github.com/${tricky}` });
  });
});

describe("verifyResult", () => {
  const rule = { required: ["tag", "url"], match: { url: "github\\.com/{{repo}}/releases", latest: "^true$" } };

  it("hits when required fields are present and matches pass", () => {
    const out = verifyResult(JSON.stringify({ tag: "v1", url: "https://github.com/a/b/releases", latest: true }), rule, { repo: "a/b" });
    expect(out).toEqual({ hit: true, result: { tag: "v1", url: "https://github.com/a/b/releases", latest: true } });
  });

  it("misses naming the first empty required field", () => {
    const out = verifyResult({ tag: "", url: "https://github.com/a/b/releases", latest: true }, rule, { repo: "a/b" });
    expect(out.hit).toBe(false);
    if (!out.hit) expect(out.miss).toMatch(/tag/);
  });

  it("escapes params inside match patterns", () => {
    const out = verifyResult({ tag: "v1", url: "https://github.com/aXb/releases", latest: true }, rule, { repo: "a.b" });
    expect(out.hit).toBe(false);
  });

  it("compares non-string values JSON-style", () => {
    expect(verifyResult({ tag: "v1", url: "https://github.com/a/b/releases", latest: true }, rule, { repo: "a/b" }).hit).toBe(true);
    expect(verifyResult({ tag: "v1", url: "https://github.com/a/b/releases", latest: "True" }, rule, { repo: "a/b" }).hit).toBe(false);
  });

  it("misses when the final eval result is not a JSON object", () => {
    for (const bad of ["not json", "[1,2]", "null", 42]) {
      expect(verifyResult(bad, rule, { repo: "a/b" }).hit, String(bad)).toBe(false);
    }
  });
});
