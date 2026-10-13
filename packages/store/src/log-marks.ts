import { join } from "node:path";
import type { LogCounts, LogMarks } from "@tyto/core";
import { readIfExists, writePrivate } from "./files.ts";

const SESSION = /^[\w-]+$/;
const ZERO: LogCounts = { console: 0, errors: 0, requests: 0 };

function count(v: unknown): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0;
}

/** `<dir>/<session>.json` holding the log offsets taken when the session last opened a page. */
export class FileLogMarks implements LogMarks {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
  }

  #path(session: string): string {
    if (!SESSION.test(session)) throw new Error(`invalid session name: ${session}`);
    return join(this.#dir, `${session}.json`);
  }

  async get(session: string): Promise<LogCounts> {
    const text = await readIfExists(this.#path(session));
    if (text === null) return { ...ZERO };
    try {
      const o = JSON.parse(text) as Record<string, unknown>;
      return { console: count(o.console), errors: count(o.errors), requests: count(o.requests) };
    } catch {
      return { ...ZERO };
    }
  }

  async set(session: string, counts: LogCounts): Promise<void> {
    await writePrivate(this.#path(session), `${JSON.stringify(counts)}\n`);
  }
}
