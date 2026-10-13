import { join } from "node:path";
import type { Trace, TraceStore } from "@tyto/core";
import { readIfExists, writePrivate } from "./files.ts";

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Traces as `<dir>/<name>.json`, 0600. Traces never contain typed values the user did not keep. */
export class FileTraceStore implements TraceStore {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
  }

  async save(trace: Trace): Promise<void> {
    if (!NAME.test(trace.name)) throw new Error(`invalid trace name: ${trace.name}`);
    await writePrivate(join(this.#dir, `${trace.name}.json`), `${JSON.stringify(trace, null, 2)}\n`);
  }

  async get(name: string): Promise<Trace | null> {
    if (!NAME.test(name)) throw new Error(`invalid trace name: ${name}`);
    const text = await readIfExists(join(this.#dir, `${name}.json`));
    return text === null ? null : (JSON.parse(text) as Trace);
  }
}
