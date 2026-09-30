#!/usr/bin/env node
// Stand-in for `tyto` in offline compiler tests: logs argv and stdin, answers like compile-tool.
import { appendFileSync } from "node:fs";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  const argv = process.argv.slice(2);
  if (process.env.FAKE_TYTO_LOG) appendFileSync(process.env.FAKE_TYTO_LOG, JSON.stringify({ argv, stdin: input, dir: process.env.TYTO_COMPILE_DIR ?? null }) + "\n");
  if (argv[1] === "draft") process.stdout.write("draft d1 saved (2 steps, params: species)\n");
  else if (argv[1] === "test") process.stdout.write(JSON.stringify({ hit: { status: "Endangered" } }) + "\n");
  else process.stdout.write(`ran ${argv.join(" ")}\n`);
});
