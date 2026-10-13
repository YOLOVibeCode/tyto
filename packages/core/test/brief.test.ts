import { describe, expect, it } from "vitest";
import { SecretRedactor, afterAction, assembleBrief, findLines, normalizeRefs, renderBrief, type BriefInput } from "../src/index.ts";

function input(overrides: Partial<BriefInput> = {}): BriefInput {
  return {
    url: "http://127.0.0.1:8765/shop",
    title: "Shop",
    snapshot: '- heading "Shop" [level=1, ref=e1]',
    console: [],
    errors: [],
    requests: [
      { requestId: "1", url: "http://127.0.0.1:8765/shop", method: "GET", status: 200, resourceType: "Document" },
    ],
    cookies: [],
    localStorage: {},
    sessionStorage: {},
    page: { framework: [], status: 200, dclMs: 12, loadMs: 20, headings: ["h1 Shop"], forms: 0, iframes: 0, text: "Shop No items" },
    bodies: {},
    mark: { console: 0, errors: 0, requests: 0 },
    now: 1_790_000_000_000,
    ...overrides,
  };
}

const redactor = new SecretRedactor();

describe("brief", () => {
  it("lists failed Fetch/XHR requests with a redacted response snippet", () => {
    const b = assembleBrief(
      input({
        requests: [
          { requestId: "1", url: "http://127.0.0.1:8765/shop", method: "GET", status: 200, resourceType: "Document" },
          { requestId: "2", url: "http://127.0.0.1:8765/api/items", method: "GET", status: 500, resourceType: "Fetch" },
        ],
        bodies: { "2": '{"error":"database timeout","token":"s3cr3tTOKEN"}' },
      }),
      redactor,
    );
    const issue = b.issues.find((i) => i.includes("/api/items"));
    expect(issue).toMatch(/500 GET \/api\/items \(Fetch\).*database timeout/);
    expect(issue).not.toContain("s3cr3tTOKEN");
    expect(b.network.api).toEqual(["GET /api/items → 500"]);
  });

  it("lists uncaught errors and console errors and warnings", () => {
    const b = assembleBrief(
      input({
        errors: [{ text: "TypeError: Cannot read properties of undefined (reading 'id')" }],
        console: [
          { type: "log", text: "saving" },
          { type: "error", text: "items API failed: 500" },
          { type: "warning", text: "deprecated API" },
        ],
      }),
      redactor,
    );
    expect(b.issues).toEqual([
      "uncaught TypeError: Cannot read properties of undefined (reading 'id')",
      "console.error 'items API failed: 500'",
      "console.warning 'deprecated API'",
    ]);
  });

  it("scopes console, errors, and requests to the current navigation by offsets", () => {
    const b = assembleBrief(
      input({
        console: [{ type: "error", text: "old page error" }, { type: "error", text: "new page error" }],
        errors: [{ text: "TypeError: old" }],
        requests: [
          { requestId: "1", url: "http://127.0.0.1:8765/old", method: "GET", status: 500, resourceType: "Fetch" },
          { requestId: "2", url: "http://127.0.0.1:8765/shop", method: "GET", status: 200, resourceType: "Document" },
        ],
        mark: { console: 1, errors: 1, requests: 1 },
      }),
      redactor,
    );
    expect(b.issues).toEqual(["console.error 'new page error'"]);
    expect(b.network.total).toBe(1);
  });

  it("shows cookie names, httpOnly, and lifetime, never values", () => {
    const b = assembleBrief(
      input({
        cookies: [
          { name: "sid", domain: "127.0.0.1", httpOnly: true, session: true, value: "SECRETVALUE" },
          { name: "remember", domain: "127.0.0.1", httpOnly: true, expires: 1_790_000_000 + 30 * 86_400, value: "LONGSECRET" },
        ],
      }),
      redactor,
    );
    expect(b.cookies).toEqual([
      { name: "sid", domain: "127.0.0.1", httpOnly: true, lifetime: "session" },
      { name: "remember", domain: "127.0.0.1", httpOnly: true, lifetime: "30d" },
    ]);
    const text = renderBrief(b);
    expect(text).not.toMatch(/SECRETVALUE|LONGSECRET/);
    expect(text).toMatch(/sid\(httpOnly session\)/);
  });

  it("ignores favicon 404s", () => {
    const b = assembleBrief(
      input({
        requests: [
          { requestId: "1", url: "http://127.0.0.1:8765/shop", method: "GET", status: 200, resourceType: "Document" },
          { requestId: "2", url: "http://127.0.0.1:8765/favicon.ico", method: "GET", status: 404, resourceType: "Other" },
        ],
      }),
      redactor,
    );
    expect(b.issues).toEqual([]);
    expect(b.network.total).toBe(1);
  });

  it("caps interactive elements at 40 and reports the remainder", () => {
    const snapshot = Array.from({ length: 45 }, (_, i) => `- link "Item ${i}" [ref=e${i + 1}]`).join("\n");
    const b = assembleBrief(input({ snapshot }), redactor);
    expect(b.elements).toHaveLength(40);
    expect(b.elementsTotal).toBe(45);
    expect(renderBrief(b)).toMatch(/… 5 more/);
  });

  it("renders page, issues, network, state, outline, elements, and text sections", () => {
    const text = renderBrief(assembleBrief(input(), redactor));
    for (const section of ["PAGE", "APP", "ISSUES", "NETWORK", "STATE", "OUTLINE", "ELEMENTS", "TEXT"]) expect(text).toContain(section);
    expect(text).toMatch(/tokens\)$/);
  });
});

describe("find", () => {
  it("returns lines containing all words with following context, at most 8", () => {
    const lines = ["Snowy owl", "Conservation status", "Vulnerable (IUCN 3.1)", "Scientific classification", ...Array.from({ length: 20 }, () => "owl status note")];
    const hits = findLines(lines.join("\n"), "conservation status");
    expect(hits.count).toBe(1);
    expect(hits.hits[0]).toBe("Conservation status ⏎ Vulnerable (IUCN 3.1) ⏎ Scientific classification");
    const many = findLines(lines.join("\n"), "owl status");
    expect(many.count).toBe(20);
    expect(many.hits).toHaveLength(8);
  });

  it("is case-insensitive and needs every word", () => {
    expect(findLines("Tiger\nEndangered species", "ENDANGERED").count).toBe(1);
    expect(findLines("Tiger\nEndangered species", "endangered tiger").count).toBe(0);
  });
});

describe("afterAction", () => {
  it("reports navigation, new requests, errors, and console since the action", () => {
    const text = afterAction(
      { url: "http://x.test/login", console: 1, errors: 0, requests: 2 },
      {
        url: "http://x.test/account",
        console: [{ type: "log", text: "old" }, { type: "log", text: "saving" }],
        errors: [{ text: "TypeError: x is undefined" }],
        requests: [
          { requestId: "1", url: "http://x.test/login", method: "GET", status: 200 },
          { requestId: "2", url: "http://x.test/a.js", method: "GET", status: 200 },
          { requestId: "3", url: "http://x.test/login", method: "POST", status: 303 },
          { requestId: "4", url: "http://x.test/favicon.ico", method: "GET", status: 404 },
        ],
      },
    );
    expect(text.split("\n")).toEqual([
      "AFTER",
      "  → now at http://x.test/account",
      "  net POST /login → 303",
      "  ✗ uncaught TypeError: x is undefined",
      "  console.log 'saving'",
    ]);
  });

  it("says so when nothing happened", () => {
    const same = { url: "http://x.test/", console: [], errors: [], requests: [] };
    expect(afterAction({ url: "http://x.test/", console: 0, errors: 0, requests: 0 }, same)).toBe("AFTER\n  no navigation, requests, or console output");
  });
});

describe("normalizeRefs", () => {
  it("bare e12 refs are rewritten to @e12", () => {
    expect(normalizeRefs(["click", "e12"])).toEqual(["click", "@e12"]);
    expect(normalizeRefs(["fill", "@e3", "e4 is text"])).toEqual(["fill", "@e3", "e4 is text"]);
  });
});
