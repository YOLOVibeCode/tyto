import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AgentBrowserMissingError, BatchOutputError } from "@tyto/core";
import { AgentBrowserRunner } from "../src/index.ts";

const FAKE = fileURLToPath(new URL("./fixtures/fake-agent-browser.mjs", import.meta.url));

async function logFile(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "tyto-ab-")), "argv.log");
}

function runner(env: Record<string, string>): AgentBrowserRunner {
  return new AgentBrowserRunner({ bin: FAKE, baseEnv: { ...process.env, ...env } });
}

describe("AgentBrowserRunner", () => {
  it("BrowserRunner.batch sends steps as JSON on stdin and parses results", async () => {
    const r = runner({ FAKE_AB_MODE: "ok" });
    const out = await r.batch([["open", "https://example.com"], ["eval", "-b", "e30="]], { session: "s" });
    expect(out).toEqual([
      { command: ["open", "https://example.com"], success: true, result: { result: "ok:open", config: null }, error: null },
      { command: ["eval", "-b", "e30="], success: true, result: { result: "ok:eval", config: null }, error: null },
    ]);
  });

  it("run puts --session and session args before the command", async () => {
    const log = await logFile();
    const r = runner({ FAKE_AB_LOG: log });
    await r.run(["get", "url"], { session: "tyto-rx", args: ["--allowed-domains", "example.com"] });
    const argv = JSON.parse((await readFile(log, "utf8")).trim());
    expect(argv).toEqual(["--session", "tyto-rx", "--allowed-domains", "example.com", "get", "url"]);
  });

  it("batch runs as `batch --bail --json` and passes env to the child", async () => {
    const log = await logFile();
    const r = runner({ FAKE_AB_LOG: log });
    const out = await r.batch([["get", "url"]], { session: "s", env: { AGENT_BROWSER_CONFIG: "/tmp/tyto.json" } });
    expect(out[0]?.result).toEqual({ result: "ok:get", config: "/tmp/tyto.json" });
    expect(JSON.parse((await readFile(log, "utf8")).trim())).toEqual(["--session", "s", "batch", "--bail", "--json"]);
  });

  it("a failing step is reported, not thrown, even when agent-browser exits non-zero", async () => {
    const out = await runner({ FAKE_AB_MODE: "fail-last" }).batch([["open", "https://x.test"], ["click", "#x"]], { session: "s" });
    expect(out[1]).toMatchObject({ success: false, error: "Element not found: #x" });
  });

  it("a missing binary throws AgentBrowserMissingError", async () => {
    const r = new AgentBrowserRunner({ bin: "/nonexistent/agent-browser" });
    await expect(r.batch([["get", "url"]], { session: "s" })).rejects.toBeInstanceOf(AgentBrowserMissingError);
  });

  it("abort kills the child process", async () => {
    const started = Date.now();
    const p = runner({ FAKE_AB_MODE: "hang" }).batch([["get", "url"]], { session: "s", signal: AbortSignal.timeout(100) });
    await expect(p).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("unreadable batch output throws BatchOutputError", async () => {
    await expect(runner({ FAKE_AB_MODE: "garbage" }).batch([["get", "url"]], { session: "s" })).rejects.toBeInstanceOf(BatchOutputError);
  });
});
