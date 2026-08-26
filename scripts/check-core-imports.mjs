#!/usr/bin/env node
/** Fail if @tyto/core imports Playwright, CDP clients, or vendor LLM SDKs. */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "packages/core");
const FORBIDDEN = [
  /from ['"]playwright/,
  /require\(['"]playwright/,
  /chrome-remote-interface/,
  /from ['"]puppeteer/,
  /litellm/i,
  /from ['"]@anthropic-ai\/sdk/,
  /from ['"]openai['"]/,
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

const files = walk(join(ROOT, "src")).concat(walk(join(ROOT, "test")));
const hits = [];
for (const f of files) {
  const text = readFileSync(f, "utf8");
  for (const re of FORBIDDEN) {
    if (re.test(text)) hits.push(f);
  }
}

if (hits.length) {
  console.error("@tyto/core must not import Playwright, CDP sockets, or vendor LLM SDKs:");
  for (const h of hits) console.error("  " + h);
  process.exit(1);
}

console.log("Core import boundary: clean");
