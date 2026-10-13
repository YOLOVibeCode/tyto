import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type InstallOptions = { home: string; binDir: string; nodePath: string; cliBin: string };
type Io = { out: (line: string) => void; err: (line: string) => void };

export const TYTO_SKILL = `---
name: tyto
description: Replays repeated browser tasks in about a second with no model, and gives one-call page briefs (failed requests with bodies, JavaScript errors, console, API calls). Use before browsing a site where a task may already be a recipe, when a browser task will repeat or run over many inputs, or when you need to know why a page is broken. Works on top of agent-browser.
allowed-tools: Bash(tyto:*)
---

# tyto

1. **Before browsing**, run \`tyto recipes\`. If one matches, \`tyto run <name> --param value\` answers in about
   0.3 s with no model. Exit 0 prints the JSON answer. Exit 3 is a MISS (the site changed): run the printed
   \`tyto repair …\` command, or fall back to agent-browser.
2. **A task that will repeat**: \`tyto learn <name> --session <s>\`, do it once with \`agent-browser --session <s> …\`,
   check typed inputs with \`tyto learn status <name>\`, then
   \`tyto learn stop <name> --task "<what it answers>" --param input_N=<param>\` and \`tyto compile <name>\`.
3. **Why is a page broken?** \`tyto open <url> --session <s>\` prints the brief. \`tyto find <words>\` searches the
   whole page. \`tyto click|fill|press … --session <s>\` acts and prints what happened next.
4. Recipes that use the user's logins run only after the user approves them with \`tyto recipes approve <name>\`.
   Never approve one on the user's behalf.
`;

const STEP_4 = `4. **Repeats**: check \`tyto recipes\` first; if one matches, \`tyto run <name> --param value\` (~0.3 s, no
   model). For a task that will repeat, record it once: \`tyto learn <name> --session <s>\` → do it with
   agent-browser → \`tyto learn stop …\` → \`tyto compile <name>\`. On a MISS, run the printed \`tyto repair …\`
   or fall back to browsing.
`;

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function readOr(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") return null;
    throw err;
  }
}

async function writeSkill(path: string, manifest: Record<string, string>, io: Io): Promise<void> {
  const current = await readOr(path);
  const edited = current !== null && current !== TYTO_SKILL && manifest[path] !== sha(current);
  if (edited) {
    io.out(`  kept your edited ${path}`);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, TYTO_SKILL);
  manifest[path] = sha(TYTO_SKILL);
  io.out(`  ✓ skill ${path}`);
}

async function updateRule(path: string, io: Io): Promise<void> {
  const text = await readOr(path);
  if (text === null) return;
  if (text.includes("tyto recipes")) {
    io.out(`  ✓ rule already mentions tyto: ${path}`);
    return;
  }
  const step4 = /^4\. \*\*Repeats\*\*[\s\S]*?(?=^5\. )/m;
  if (!step4.test(text)) {
    io.out(`  ! left ${path} alone (no step 4 "Repeats" to replace)`);
    return;
  }
  await writeFile(path, text.replace(step4, STEP_4));
  io.out(`  ✓ rule ${path}`);
}

/** Put `tyto` on PATH (pinned to this Node), install the skill for Claude Code and Cursor, and update the web-access rule. */
export async function install(opts: InstallOptions, io: Io): Promise<number> {
  const launcher = join(opts.binDir, "tyto");
  await mkdir(opts.binDir, { recursive: true });
  await writeFile(launcher, `#!/bin/sh\n# tyto launcher (tyto install). Pinned to the Node that installed it.\nexec ${JSON.stringify(opts.nodePath)} ${JSON.stringify(opts.cliBin)} "$@"\n`);
  await chmod(launcher, 0o755);
  io.out(`  ✓ launcher ${launcher}  (Node ${opts.nodePath})`);

  const manifestPath = join(opts.home, ".tyto", "installed.json");
  const manifest = JSON.parse((await readOr(manifestPath)) ?? "{}") as Record<string, string>;
  await writeSkill(join(opts.home, ".claude", "skills", "tyto", "SKILL.md"), manifest, io);
  await writeSkill(join(opts.home, ".cursor", "skills", "tyto", "SKILL.md"), manifest, io);
  await mkdir(dirname(manifestPath), { recursive: true, mode: 0o700 });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });

  await updateRule(join(opts.home, ".claude", "rules", "web-access.md"), io);
  await updateRule(join(opts.home, ".cursor", "rules", "web-access.mdc"), io);
  io.out("Done. Check with: tyto doctor");
  return 0;
}
