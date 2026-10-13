import { describe, expect, it } from "vitest";
import { SecretRedactor, type BatchStepResult, type RunOptions, type RunOutput } from "@tyto/core";
import { FakeBrowserRunner, FakeCompiler, FakeSessionLock, MemoryLogMarks, MemoryRecipeStore, MemoryTraceStore } from "@tyto/core/testing";
import { main, type CliDeps } from "../src/index.ts";

/** A scripted page that answers agent-browser commands with agent-browser's JSON shapes. */
class FakePage {
  url = "about:blank";
  title = "";
  console: Array<{ type: string; text: string }> = [];
  errors: Array<{ text: string }> = [];
  requests: Array<{ requestId: string; url: string; method: string; status: number; resourceType: string }> = [];
  bodyText = "";

  load(url: string): void {
    this.url = url;
    this.title = "Shop";
    this.requests.push({ requestId: `r${this.requests.length}`, url, method: "GET", status: 200, resourceType: "Document" });
    this.requests.push({ requestId: "api", url: "http://127.0.0.1:8765/api/items", method: "GET", status: 500, resourceType: "Fetch" });
    this.console.push({ type: "error", text: "items API failed: 500" });
    this.bodyText = "Shop\nNo items\nConservation status\nVulnerable (IUCN 3.1)";
  }

  answer(command: readonly string[]): unknown {
    const [cmd, sub] = command;
    if (cmd === "get" && sub === "url") return { url: this.url };
    if (cmd === "get" && sub === "title") return { title: this.title };
    if (cmd === "snapshot") return { snapshot: '- heading "Shop" [level=1, ref=e1]\n- button "Save" [ref=e2]' };
    if (cmd === "console") return { messages: this.console };
    if (cmd === "errors") return { errors: this.errors };
    if (cmd === "network") return { requests: this.requests };
    if (cmd === "cookies") return { cookies: [{ name: "sid", value: "SECRET", httpOnly: true, session: true, domain: "127.0.0.1" }] };
    if (cmd === "storage") return { data: {} };
    if (cmd === "eval") {
      const code = new TextDecoder().decode(Uint8Array.from(atob(command[2] ?? ""), (c) => c.charCodeAt(0)));
      if (code.includes("innerText")) return { result: code.includes("performance") ? JSON.stringify({ status: 200, text: "Shop No items", headings: ["h1 Shop"] }) : this.bodyText };
    }
    return {};
  }
}

function harness() {
  const page = new FakePage();
  const runner = new FakeBrowserRunner((steps): BatchStepResult[] =>
    steps.map((command) => ({ command, success: true, result: page.answer(command), error: null })),
  );
  runner.onRun = (argv: readonly string[], _opts: RunOptions): RunOutput => {
    if (argv[0] === "open") page.load(argv[1] ?? "");
    if (argv[0] === "click" && argv[1] === "@e2") page.errors.push({ text: "TypeError: draft is undefined" });
    if (argv[0] === "network" && argv[1] === "request") {
      return { exitCode: 0, stdout: JSON.stringify({ success: true, data: { responseBody: '{"error":"database timeout"}' } }), stderr: "" };
    }
    if (argv[0] === "find") return { exitCode: 0, stdout: "✓ Done\n", stderr: "" };
    return { exitCode: 0, stdout: "✓ Done\n", stderr: "" };
  };
  const out: string[] = [];
  const marks = new MemoryLogMarks();
  const deps: CliDeps = {
    store: new MemoryRecipeStore(),
    exec: { runner, lock: new FakeSessionLock(), paths: { config: "/c.json", policy: "/p.json" } },
    browse: { runner, marks, redactor: new SecretRedactor(), session: "default", now: () => 1_790_000_000_000 },
    learn: { spawnListener: async () => undefined, control: async () => ({ ok: false }) },
    traces: new MemoryTraceStore(),
    compiler: new FakeCompiler(),
    compileTool: { dir: undefined, readStdin: async () => "" },
    confirm: async () => false,
    out: (s) => out.push(s),
    err: (s) => out.push(`ERR ${s}`),
  };
  return { deps, out, runner, page, marks };
}

describe("tyto browse commands", () => {
  it("tyto open marks the logs, opens the page, and prints the brief", async () => {
    const h = harness();
    h.page.console.push({ type: "error", text: "error from an earlier page" });
    expect(await main(["open", "http://127.0.0.1:8765/shop"], h.deps)).toBe(0);
    expect(await h.marks.get("default")).toEqual({ console: 1, errors: 0, requests: 0 });
    expect(h.runner.runs.map((r) => r.argv[0])).toContain("open");
    const text = h.out.join("\n");
    expect(text).toMatch(/network 500 GET \/api\/items \(Fetch\) → \{"error":"database timeout"\}/);
    expect(text).toMatch(/console.error 'items API failed: 500'/);
    expect(text).not.toMatch(/earlier page/);
    expect(text).not.toMatch(/SECRET/);
  });

  it("browse commands never change agent-browser settings mid-session (a changed setting restarts the browser)", async () => {
    const h = harness();
    await main(["open", "http://127.0.0.1:8765/shop"], h.deps);
    await main(["click", "e2"], h.deps);
    expect(h.runner.runs.every((r) => r.opts.env === undefined)).toBe(true);
    expect(h.runner.batches.every((b) => b.opts.env === undefined)).toBe(true);
  });

  it("tyto brief --json prints the brief as JSON", async () => {
    const h = harness();
    await main(["open", "http://127.0.0.1:8765/shop"], h.deps);
    h.out.length = 0;
    expect(await main(["brief", "--json"], h.deps)).toBe(0);
    const brief = JSON.parse(h.out.join("")) as { url: string; issues: string[]; cookies: Array<{ name: string }> };
    expect(brief.url).toBe("http://127.0.0.1:8765/shop");
    expect(brief.issues.length).toBe(2);
    expect(brief.cookies[0]?.name).toBe("sid");
  });

  it("--session selects the agent-browser session", async () => {
    const h = harness();
    await main(["open", "http://127.0.0.1:8765/shop", "--session", "task-7"], h.deps);
    expect(h.runner.runs.every((r) => r.opts.session === "task-7")).toBe(true);
    expect(await h.marks.get("task-7")).toEqual({ console: 0, errors: 0, requests: 0 });
  });

  it("agent-browser restore status lines are not echoed", async () => {
    const h = harness();
    const base = h.runner.onRun;
    h.runner.onRun = (argv, opts) => {
      const r = base ? base(argv, opts) : { exitCode: 0, stdout: "", stderr: "" };
      return { ...r, stderr: "[agent-browser] restore: loaded; save: saved\n" };
    };
    await main(["click", "e2"], h.deps);
    expect(h.out.join("\n")).not.toMatch(/restore: loaded/);
  });

  it("tyto find searches the whole page text", async () => {
    const h = harness();
    await main(["open", "http://127.0.0.1:8765/shop"], h.deps);
    h.out.length = 0;
    expect(await main(["find", "conservation", "status"], h.deps)).toBe(0);
    expect(h.out.join("\n")).toMatch(/Conservation status ⏎ Vulnerable \(IUCN 3\.1\)/);
  });

  it("tyto find with a locator keyword passes through to agent-browser find", async () => {
    const h = harness();
    expect(await main(["find", "role", "button", "click", "--name", "Save"], h.deps)).toBe(0);
    expect(h.runner.runs.at(-1)?.argv).toEqual(["find", "role", "button", "click", "--name", "Save"]);
  });

  it("tyto click prints what happened after the action, accepting e2 for @e2", async () => {
    const h = harness();
    await main(["open", "http://127.0.0.1:8765/shop"], h.deps);
    h.out.length = 0;
    expect(await main(["click", "e2"], h.deps)).toBe(0);
    expect(h.runner.runs.some((r) => r.argv[0] === "click" && r.argv[1] === "@e2")).toBe(true);
    expect(h.out.join("\n")).toMatch(/AFTER\n {2}✗ uncaught TypeError: draft is undefined/);
  });
});
