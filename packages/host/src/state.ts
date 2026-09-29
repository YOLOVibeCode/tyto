import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HostTokens } from "./auth.ts";

/** Where a running host can be found. Never contains a token. */
export type HostState = { url: string; port: number; pid: number };

export type HostStateWithTokens = HostState & { tokens: HostTokens };

export function tytoHome(env: Record<string, string | undefined>): string {
  const home = env.TYTO_HOME;
  return home !== undefined && home !== "" ? home : join(homedir(), ".tyto");
}

/** host.json (no token) + tokens/{power,safe} at 0600, written atomically. */
export async function writeHostState(home: string, state: HostState, tokens: HostTokens): Promise<void> {
  const tokenDir = join(home, "tokens");
  await mkdir(tokenDir, { recursive: true, mode: 0o700 });
  await writePrivate(join(tokenDir, "power"), tokens.power);
  await writePrivate(join(tokenDir, "safe"), tokens.safe);
  await writePrivate(join(home, "host.json"), `${JSON.stringify(state)}\n`);
}

export async function readHostState(home: string): Promise<HostStateWithTokens | null> {
  const raw = await readIfExists(join(home, "host.json"));
  if (raw === null) return null;
  const parsed = JSON.parse(raw) as Partial<HostState>;
  if (typeof parsed.url !== "string" || typeof parsed.port !== "number" || typeof parsed.pid !== "number") {
    throw new Error("host.json invalid");
  }
  const power = await readIfExists(join(home, "tokens", "power"));
  const safe = await readIfExists(join(home, "tokens", "safe"));
  if (power === null || safe === null) throw new Error("host tokens missing");
  return { url: parsed.url, port: parsed.port, pid: parsed.pid, tokens: { power: power.trim(), safe: safe.trim() } };
}

export async function clearHostState(home: string): Promise<void> {
  await rm(join(home, "host.json"), { force: true });
  await rm(join(home, "tokens"), { recursive: true, force: true });
}

async function writePrivate(path: string, text: string): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, text, { encoding: "utf8", mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, path);
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") return null;
    throw err;
  }
}
