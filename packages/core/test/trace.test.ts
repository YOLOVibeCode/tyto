import { describe, expect, it } from "vitest";
import { SecretRedactor, actionToArgv, buildTrace, type StreamEvent } from "../src/index.ts";

let seq = 0;
function cmd(action: string, params: Record<string, unknown> = {}): { command: StreamEvent; id: string } {
  seq += 1;
  const id = `r${seq}`;
  return { id, command: { type: "command", id, action, params: { action, id, ...params }, timestamp: seq } };
}
function res(id: string, action: string, data: Record<string, unknown> = {}): StreamEvent {
  return { type: "result", id, action, success: false, data: { lifecycle: { launched: false }, ...data }, duration_ms: 1, timestamp: seq };
}
/** A command followed by its result. */
function pair(action: string, params: Record<string, unknown> = {}, data: Record<string, unknown> = {}): StreamEvent[] {
  const c = cmd(action, params);
  return [c.command, res(c.id, action, data)];
}

const opts = { name: "login", session: "s", redactor: new SecretRedactor(), now: () => 1_000 };

describe("actionToArgv", () => {
  it("maps navigate, click, fill, type, press, select, check, waits, eval, get, snapshot, and find locators", () => {
    const cases: Array<[string, Record<string, unknown>, string[]]> = [
      ["navigate", { url: "https://x.test/" }, ["open", "https://x.test/"]],
      ["click", { selector: "#go" }, ["click", "#go"]],
      ["fill", { selector: "#q", value: "owl" }, ["fill", "#q", "owl"]],
      ["type", { selector: "#q", text: "owl" }, ["type", "#q", "owl"]],
      ["press", { key: "Enter" }, ["press", "Enter"]],
      ["select", { selector: "#size", values: ["m", "l"] }, ["select", "#size", "m", "l"]],
      ["check", { selector: "#tos" }, ["check", "#tos"]],
      ["waitforurl", { url: "**/done" }, ["wait", "--url", "**/done"]],
      ["waitforloadstate", { state: "load" }, ["wait", "--load", "load"]],
      ["wait", { text: "Saved" }, ["wait", "--text", "Saved"]],
      ["evaluate", { script: "document.title" }, ["eval", "document.title"]],
      ["url", {}, ["get", "url"]],
      ["gettext", { selector: "h1" }, ["get", "text", "h1"]],
      ["getattribute", { selector: "a", attribute: "href" }, ["get", "attr", "a", "href"]],
      ["snapshot", { interactive: true }, ["snapshot", "-i"]],
      ["getbylabel", { label: "Email", subaction: "fill", value: "a@b.test" }, ["find", "label", "Email", "fill", "a@b.test"]],
      ["getbyrole", { role: "button", subaction: "click", name: "Save", exact: true }, ["find", "role", "button", "click", "--name", "Save", "--exact"]],
      ["getbyplaceholder", { placeholder: "Search", subaction: "fill", value: "owl" }, ["find", "placeholder", "Search", "fill", "owl"]],
      ["nth", { selector: ".card", index: 0, subaction: "click" }, ["find", "first", ".card", "click"]],
      ["nth", { selector: ".card", index: 2, subaction: "click" }, ["find", "nth", "2", ".card", "click"]],
    ];
    for (const [action, params, argv] of cases) expect(actionToArgv(action, params), action).toEqual(argv);
  });

  it("unknown actions map to null", () => {
    expect(actionToArgv("webmcp_invoke", { tool: "x" })).toBeNull();
  });
});

describe("buildTrace", () => {
  it("pairs command and result events by id into trace steps", () => {
    const events = [...pair("navigate", { url: "https://x.test/login" }), ...pair("click", { selector: "#go" }, { clicked: "#go" })];
    const { trace } = buildTrace(events, opts, {});
    expect(trace.steps.map((s) => s.argv)).toEqual([["open", "https://x.test/login"], ["click", "#go"]]);
    expect(trace.lossy).toBe(false);
  });

  it("marks the trace lossy on an orphan result, a missing result, or a socket close", () => {
    const orphan = buildTrace([res("nope", "click")], opts, {}).trace;
    expect(orphan.lossy).toBe(true);
    const missing = buildTrace([cmd("click", { selector: "#go" }).command], opts, {}).trace;
    expect(missing.gaps.join(" ")).toMatch(/without a result/);
    const closed = buildTrace([...pair("url"), { type: "closed" }], opts, {}).trace;
    expect(closed.gaps.join(" ")).toMatch(/closed/);
  });

  it("ignores frame, tabs, and status messages", () => {
    const events: StreamEvent[] = [
      { type: "frame", data: "…" },
      { type: "tabs", tabs: [] },
      { type: "status", connected: true },
      ...pair("url"),
    ];
    const { trace } = buildTrace(events, opts, {});
    expect(trace.steps).toHaveLength(1);
    expect(trace.lossy).toBe(false);
  });

  it("replaces fill and type values with {{input_N}} placeholders", () => {
    const events = [
      ...pair("fill", { selector: "input[name=user]", value: "ada" }),
      ...pair("getbylabel", { label: "City", subaction: "fill", value: "Paris" }),
      ...pair("type", { selector: "#note", text: "hello there" }),
    ];
    const { trace, inputs } = buildTrace(events, opts, {});
    expect(trace.steps.map((s) => s.argv)).toEqual([
      ["fill", "input[name=user]", "{{input_1}}"],
      ["find", "label", "City", "fill", "{{input_2}}"],
      ["type", "#note", "{{input_3}}"],
    ]);
    expect(JSON.stringify(trace)).not.toMatch(/ada|Paris|hello there/);
    expect(inputs.map((i) => i.name)).toEqual(["input_1", "input_2", "input_3"]);
  });

  it("keeps only inputs named with --param and drops the rest", () => {
    const events = [...pair("fill", { selector: "#user", value: "ada" }), ...pair("getbylabel", { label: "City", subaction: "fill", value: "Paris" })];
    const { trace } = buildTrace(events, opts, { input_2: "city" });
    expect(trace.steps[1]?.argv).toEqual(["find", "label", "City", "fill", "{{city}}"]);
    expect(trace.params).toEqual({ city: "Paris" });
    expect(JSON.stringify(trace)).not.toMatch(/ada/);
  });

  it("masks values typed into password-like fields and never offers them as params", () => {
    const events = [...pair("fill", { selector: "input[name=password]", value: "hunter2hunter2" })];
    const { trace, inputs } = buildTrace(events, opts, { input_1: "pw" });
    expect(JSON.stringify(trace)).not.toContain("hunter2hunter2");
    expect(trace.params).toEqual({});
    expect(inputs[0]?.sensitive).toBe(true);
  });

  it("reduces cookie and storage values to names and lengths", () => {
    const events = [
      ...pair("cookies_get", {}, { cookies: [{ name: "sid", value: "SESSIONVALUE123", httpOnly: true }] }),
      ...pair("storage_get", { type: "local" }, { data: { token: "abcdefabcdef", theme: "dark" } }),
    ];
    const text = JSON.stringify(buildTrace(events, opts, {}).trace);
    expect(text).not.toMatch(/SESSIONVALUE123|abcdefabcdef/);
    expect(text).toMatch(/sid/);
  });

  it("runs the Redactor before the trace is returned", () => {
    const events = [...pair("evaluate", { script: "document.body.innerText" }, { result: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz" })];
    expect(JSON.stringify(buildTrace(events, opts, {}).trace)).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });

  it("keeps snapshot text and eval results as step output", () => {
    const events = [
      ...pair("snapshot", { interactive: true }, { snapshot: '- button "Save" [ref=e2]' }),
      ...pair("evaluate", { script: "document.title" }, { result: "Owl" }),
    ];
    const { trace } = buildTrace(events, opts, {});
    expect(trace.steps[0]?.output).toContain('button "Save"');
    expect(trace.steps[1]?.output).toContain("Owl");
  });

  it("collects the origins the task opened", () => {
    const events: StreamEvent[] = [...pair("navigate", { url: "https://a.test/x" }), { type: "url", url: "https://login.b.test/sso", timestamp: 9 }];
    expect(buildTrace(events, opts, {}).trace.origins).toEqual(["https://a.test", "https://login.b.test"]);
  });
});
