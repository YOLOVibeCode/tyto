#!/usr/bin/env node
// Stand-in for `claude -p` in offline tests. Records argv and relevant env, prints a canned JSON result.
import { appendFileSync, readFileSync } from "node:fs";

const log = process.env.FAKE_CLAUDE_LOG;
if (log) {
  appendFileSync(log, JSON.stringify({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    hasApiKey: "ANTHROPIC_API_KEY" in process.env,
    compileDir: process.env.TYTO_COMPILE_DIR ?? null,
    path: process.env.PATH ?? "",
    context: process.env.TYTO_COMPILE_DIR ? JSON.parse(readFileSync(`${process.env.TYTO_COMPILE_DIR}/context.json`, "utf8")) : null,
  }) + "\n");
}
if (process.env.FAKE_CLAUDE_MODE === "fail") {
  process.stdout.write(JSON.stringify({ is_error: true, result: "boom" }));
  process.exit(1);
}
process.stdout.write(JSON.stringify({ is_error: false, num_turns: 7, result: "```json\n{\"name\":\"x\"}\n```" }));
