#!/usr/bin/env node
// Stand-in for the agent-browser binary in offline tests. Behavior comes from FAKE_AB_MODE.
import { appendFileSync } from "node:fs";

const argv = process.argv.slice(2);
if (process.env.FAKE_AB_LOG) appendFileSync(process.env.FAKE_AB_LOG, JSON.stringify(argv) + "\n");
const mode = process.env.FAKE_AB_MODE ?? "ok";

if (mode === "hang") {
  setInterval(() => {}, 1000);
} else if (argv.includes("batch")) {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (input += c));
  process.stdin.on("end", () => {
    if (mode === "garbage") {
      process.stdout.write("not json\n");
      process.stderr.write("daemon exploded\n");
      process.exit(1);
    }
    const steps = JSON.parse(input);
    const out = steps.map((command, i) => ({
      command,
      error: mode === "fail-last" && i === steps.length - 1 ? "Element not found: #x" : null,
      result: { lifecycle: { launched: i === 0 }, result: `ok:${command[0]}`, config: process.env.AGENT_BROWSER_CONFIG ?? null },
      success: !(mode === "fail-last" && i === steps.length - 1),
    }));
    process.stdout.write(JSON.stringify(out) + "\n");
    process.exit(mode === "fail-last" ? 1 : 0);
  });
} else {
  process.stdout.write(`ran ${argv.join(" ")}\n`);
}
