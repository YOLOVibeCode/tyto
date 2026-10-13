import { describe, expect, it } from "vitest";
import { Recorder, type BatchStepResult } from "../src/index.ts";
import { FakeBrowserRunner, FakeEventSource } from "../src/testing/index.ts";

function setup() {
  const events = new FakeEventSource();
  const runner = new FakeBrowserRunner((): BatchStepResult[] => []);
  // The sync marker: `get url` shows up on the stream as a url command + result.
  runner.onRun = (argv) => {
    if (argv[0] === "get" && argv[1] === "url") {
      events.emit({ type: "command", id: "marker", action: "url", params: {} }, { type: "result", id: "marker", action: "url", data: {} });
    }
    return { exitCode: 0, stdout: "about:blank", stderr: "" };
  };
  return { events, runner, recorder: new Recorder({ events, runner }) };
}

describe("Recorder", () => {
  it("learn waits for the sync marker before recording", async () => {
    const { events, runner, recorder } = setup();
    events.emit({ type: "command", id: "old", action: "click", params: { selector: "#before" } });
    const ac = new AbortController();
    await recorder.start("s", ac.signal);
    expect(runner.runs.map((r) => r.argv)).toEqual([["get", "url"]]);
    events.emit({ type: "command", id: "c1", action: "click", params: { selector: "#go" } }, { type: "result", id: "c1", action: "click", data: {} });
    await new Promise((r) => setTimeout(r, 10));
    ac.abort();
    const recorded = recorder.events();
    expect(recorded.map((e) => e.id)).toEqual(["c1", "c1"]);
  });

  it("records a closed event when the stream ends", async () => {
    const { events, recorder } = setup();
    const ac = new AbortController();
    await recorder.start("s", ac.signal);
    events.emit({ type: "closed" });
    await new Promise((r) => setTimeout(r, 10));
    expect(recorder.events().at(-1)).toEqual({ type: "closed" });
    ac.abort();
  });
});
