import { mkdir, open, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Release, SessionLock } from "@tyto/core";
import { readIfExists } from "./files.ts";

const SESSION = /^[\w-]+$/;
const POLL_MS = 50;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err instanceof Error && "code" in err && err.code === "EPERM";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `<dir>/<session>.lock` created with O_EXCL; a lock whose holder process is gone is reclaimed. */
export class FileSessionLock implements SessionLock {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
  }

  async acquire(session: string, waitMs: number): Promise<Release | null> {
    if (!SESSION.test(session)) throw new Error(`invalid session name: ${session}`);
    await mkdir(this.#dir, { recursive: true, mode: 0o700 });
    const path = join(this.#dir, `${session}.lock`);
    const deadline = Date.now() + waitMs;
    for (;;) {
      try {
        const handle = await open(path, "wx", 0o600);
        await handle.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() }));
        await handle.close();
        return async () => {
          await rm(path, { force: true });
        };
      } catch (err) {
        if (!(err instanceof Error && "code" in err && err.code === "EEXIST")) throw err;
      }
      const holder = await readIfExists(path);
      let pid = 0;
      try {
        pid = Number((JSON.parse(holder ?? "{}") as { pid?: unknown }).pid) || 0;
      } catch {
        pid = 0;
      }
      if (!pid || !alive(pid)) {
        await rm(path, { force: true });
        continue;
      }
      if (Date.now() >= deadline) return null;
      await delay(POLL_MS);
    }
  }
}
