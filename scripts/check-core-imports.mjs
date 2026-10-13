#!/usr/bin/env node
/**
 * Keep @tyto/core pure. Its source must not spawn processes, touch the file system or network, or import
 * browser drivers or vendor LLM SDKs. Adapters (packages/agent-browser, store, compiler, cli) do that work.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "packages/core");

const VENDOR = [
  /from ['"]playwright/,
  /require\(['"]playwright/,
  /chrome-remote-interface/,
  /from ['"]puppeteer/,
  /litellm/i,
  /from ['"]@anthropic-ai\/sdk/,
  /from ['"]openai['"]/,
];

const IO = [
  /from ['"](?:node:)?child_process['"]/,
  /from ['"](?:node:)?fs(?:\/promises)?['"]/,
  /from ['"](?:node:)?(?:net|http|https|dgram|tls)['"]/,
  /\bfetch\s*\(/,
  /\bnew\s+WebSocket\s*\(/,
];

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|js|mjs)$/.test(name)) acc.push(p);
  }
  return acc;
}

const hits = [];
for (const f of walk(join(ROOT, "src"))) {
  const text = readFileSync(f, "utf8");
  for (const re of [...VENDOR, ...IO]) if (re.test(text)) hits.push(`${f}  (${re})`);
}
for (const f of walk(join(ROOT, "test"))) {
  const text = readFileSync(f, "utf8");
  for (const re of VENDOR) if (re.test(text)) hits.push(`${f}  (${re})`);
}

if (hits.length) {
  console.error("@tyto/core must stay pure (no processes, files, network, browser drivers, or vendor LLM SDKs):");
  for (const h of hits) console.error("  " + h);
  process.exit(1);
}

console.log("Core import boundary: clean");
