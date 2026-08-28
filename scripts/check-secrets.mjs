#!/usr/bin/env node
/**
 * Fail CI / pre-commit if tracked files look like they contain live secrets.
 * Complements gitleaks. Does not print matched secret values.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

const SKIP_DIR = new Set([
  "node_modules",
  ".git",
  "dist",
  "coverage",
  "tmp",
  "canvases",
]);

const SKIP_FILE = new Set([".env.example", ".gitleaks.toml"]);

/** Patterns that should never appear as live assignments in committed files. */
const PATTERNS = [
  { name: "private-key-block", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "sk-live-prefix", re: /sk-(?:ant-|proj-)[A-Za-z0-9_\-]{20,}/ },
  { name: "openai-sk", re: /sk-[a-zA-Z0-9]{32,}/ },
  { name: "tyto-key-assign", re: /(?:TYTO_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY|TYTO_HOST_TOKEN)\s*=\s*['"]?(?!changeme|your-|xxx|<)[A-Za-z0-9_\-]{16,}/ },
  { name: "set-cookie-value", re: /Set-Cookie:\s*[^=]+=[^;\s]{12,}/i },
];

const ALLOW_PATH = [
  /packages\/core\/src\/identity\/redact\.ts$/,
  /\/test\//,
  /e2e\//,
  /scripts\/check-secrets\.mjs$/,
  /\.md$/,
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function trackedFiles() {
  if (!existsSync(join(ROOT, ".git"))) {
    return walk(ROOT).map((p) => relative(ROOT, p));
  }
  const staged = process.argv.includes("--staged");
  try {
    const cmd = staged
      ? "git diff --cached --name-only --diff-filter=ACMR"
      : "git ls-files";
    return execSync(cmd, { encoding: "utf8" })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return walk(ROOT).map((p) => relative(ROOT, p));
  }
}

function allowed(rel) {
  if (SKIP_FILE.has(rel.split("/").pop() ?? "")) return true;
  return ALLOW_PATH.some((re) => re.test(rel));
}

const hits = [];
for (const rel of trackedFiles()) {
  if (rel.startsWith("node_modules/") || rel.startsWith("tmp/")) continue;
  if (allowed(rel)) continue;
  const abs = join(ROOT, rel);
  if (!existsSync(abs) || statSync(abs).isDirectory()) continue;
  let text;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    continue;
  }
  if (text.includes("\0")) continue;
  for (const { name, re } of PATTERNS) {
    if (re.test(text)) hits.push({ file: rel, rule: name });
  }
}

if (hits.length) {
  console.error("Secret scan failed. Offending files (values not printed):");
  for (const h of hits) console.error(`  ${h.file}  [${h.rule}]`);
  console.error("Remove the secret, use .env (gitignored), or rotate the credential.");
  process.exit(1);
}

console.log("Secret scan: clean");
