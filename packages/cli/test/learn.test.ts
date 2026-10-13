import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Recorder, SecretRedactor, type BatchStepResult } from "@tyto/core";
import { FakeBrowserRunner, FakeEventSource, FakeSessionLock, MemoryLogMarks, MemoryRecipeStore, MemoryTraceStore } from "@tyto/core/testing";
import { main, runListener, serveControl, requestControl, type CliDeps, type ControlReply, type ControlRequest } from "../src/index.ts";

function harness(reply: (req: ControlRequest) => ControlReply) {
  const runner = new FakeBrowserRunner((): BatchStepResult[] => []);
  const spawned: Array<{ name: string; session: string }> = [];
  const sent: ControlRequest[] = [];
  const out: string[] = [];
  const deps: CliDeps = {
    store: new MemoryRecipeStore(),
    exec: { runner, lock: new FakeSessionLock(), paths: { config: "/c", policy: "/p" } },
    browse: { runner, marks: new MemoryLogMarks(), redactor: new SecretRedactor(), session: "default", now: () => 0 },
    learn: {
      spawnListener: async (name, session) => {
        spawned.push({ name, session });
      },
      control: async (_name, req) => {
        sent.push(req);
        return reply(req);
      },
    },
    out: (s) => out.push(s),
    err: (s) => out.push(`ERR ${s}`),
  };
  return { deps, runner, spawned, sent, out };
}

describe("tyto learn", () => {
  it("tyto learn starts the session and a listener, then prints how to finish", async () => {
    const h = harness(() => ({ ok: true, inputs: [], steps: 0, lossy: false }));
    expect(await main(["learn", "wiki-status", "--session", "task-3"], h.deps)).toBe(0);
    expect(h.runner.runs[0]).toMatchObject({ argv: ["get", "url"], opts: { session: "task-3" } });
    expect(h.spawned).toEqual([{ name: "wiki-status", session: "task-3" }]);
    const text = h.out.join("\n");
    expect(text).toMatch(/--session task-3/);
    expect(text).toMatch(/tyto learn stop wiki-status --task/);
  });

  it("uses learn-<name> as the session when none is given", async () => {
    const h = harness(() => ({ ok: true, inputs: [], steps: 0, lossy: false }));
    await main(["learn", "wiki-status"], h.deps);
    expect(h.spawned[0]?.session).toBe("learn-wiki-status");
  });

  it("tyto learn stop sends the task and kept params, then prints the trace summary", async () => {
    const h = harness(() => ({ ok: true, inputs: [], steps: 5, lossy: false, params: { city: "Paris" }, trace: "/home/.tyto/traces/weather.json" }));
    expect(await main(["learn", "stop", "weather", "--task", "weather in Paris", "--param", "input_2=city"], h.deps)).toBe(0);
    expect(h.sent).toEqual([{ op: "stop", task: "weather in Paris", keep: { input_2: "city" } }]);
    expect(h.out.join("\n")).toMatch(/5 steps/);
    expect(h.out.join("\n")).toMatch(/city/);
  });

  it("tyto learn stop requires --task", async () => {
    const h = harness(() => ({ ok: true, inputs: [], steps: 0, lossy: false }));
    expect(await main(["learn", "stop", "weather"], h.deps)).toBe(64);
  });

  it("tyto learn status lists typed inputs by name and locator, never values", async () => {
    const h = harness(() => ({ ok: true, steps: 3, lossy: false, inputs: [{ name: "input_1", locator: "Search Wikipedia", sensitive: false, step: 2 }] }));
    expect(await main(["learn", "status", "wiki-status"], h.deps)).toBe(0);
    expect(h.out.join("\n")).toMatch(/input_1\s+Search Wikipedia/);
  });
});

describe("learn listener", () => {
  it("records after the marker and saves the trace with kept params when stopped", async () => {
    const events = new FakeEventSource();
    const runner = new FakeBrowserRunner((): BatchStepResult[] => []);
    runner.onRun = (argv) => {
      if (argv[1] === "url") events.emit({ type: "command", id: "m", action: "url", params: {} }, { type: "result", id: "m", action: "url", data: {} });
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const traces = new MemoryTraceStore();
    let handler: ((req: ControlRequest) => Promise<ControlReply>) | null = null;
    const done = runListener("weather", "s", {
      recorder: new Recorder({ events, runner }),
      traces,
      redactor: new SecretRedactor(),
      now: () => 5,
      serve: async (h) => {
        handler = h;
        return async () => undefined;
      },
      tracePath: (name) => `/traces/${name}.json`,
    });
    await new Promise((r) => setTimeout(r, 10));
    events.emit(
      { type: "command", id: "a", action: "navigate", params: { url: "https://weather.test/" } },
      { type: "result", id: "a", action: "navigate", data: {} },
      { type: "command", id: "b", action: "getbylabel", params: { label: "City", subaction: "fill", value: "Paris" } },
      { type: "result", id: "b", action: "getbylabel", data: {} },
    );
    await new Promise((r) => setTimeout(r, 10));
    const status = await handler!({ op: "status" });
    expect(status.inputs?.map((i) => i.name)).toEqual(["input_1"]);
    expect(JSON.stringify(status)).not.toContain("Paris");
    const reply = await handler!({ op: "stop", task: "weather in Paris", keep: { input_1: "city" } });
    expect(reply).toMatchObject({ ok: true, steps: 2, params: { city: "Paris" } });
    await done;
    expect(traces.traces.get("weather")?.steps[1]?.argv).toEqual(["find", "label", "City", "fill", "{{city}}"]);
    expect(traces.traces.get("weather")?.task).toBe("weather in Paris");
  });
});

describe("control socket", () => {
  it("client and server exchange messages over a private socket", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "tyto-ctl-")), "learn");
    const path = join(dir, "x.sock");
    const close = await serveControl(path, async (req) => ({ ok: true, steps: req.op === "status" ? 7 : 0, lossy: false, inputs: [] }));
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect(await requestControl(path, { op: "status" })).toMatchObject({ ok: true, steps: 7 });
    await close();
    await expect(requestControl(path, { op: "status" })).rejects.toThrow(/not recording/);
  });
});
