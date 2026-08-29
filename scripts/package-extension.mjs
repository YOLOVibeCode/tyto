import { spawnSync } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PACK_FILES = [
  "manifest.json",
  "background.js",
  "native-protocol.js",
  "sidepanel-sw.js",
  "sidepanel.js",
  "sidepanel.html",
  "README.md",
];

/**
 * Copy the load-unpacked MV3 files into destDir. Tests stay out.
 * @param {{ repoRoot: string, destDir: string }} opts
 */
export async function packageExtension(opts) {
  const destDir = opts.destDir;
  await mkdir(destDir, { recursive: true });
  const src = join(opts.repoRoot, "extension");
  for (const name of PACK_FILES) {
    await cp(join(src, name), join(destDir, name));
  }
}

const entry = process.argv[1];
const isMain = typeof entry === "string" && import.meta.url === pathToFileURL(resolve(entry)).href;

if (isMain) {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const destDir = join(repoRoot, "dist", "tyto-extension");
  await rm(destDir, { recursive: true, force: true });
  await packageExtension({ repoRoot, destDir });
  process.stdout.write(`${destDir}\n`);
  const zipPath = join(repoRoot, "dist", "tyto-extension.zip");
  await rm(zipPath, { force: true });
  const zipped = spawnSync("zip", ["-r", "-q", zipPath, "."], { cwd: destDir, encoding: "utf8" });
  if (zipped.status === 0) {
    process.stdout.write(`${zipPath}\n`);
  } else {
    process.stderr.write("zip skipped (install zip to emit dist/tyto-extension.zip)\n");
  }
}
