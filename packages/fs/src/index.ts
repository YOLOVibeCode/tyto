import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionStore } from "@tyto/core/ports";
import { parseSession, serializeSession, type Session, type SessionId, type SessionSummary } from "@tyto/core";

export class FilesystemSessionStore implements SessionStore {
  constructor(private readonly dir: string) {}

  async load(id: SessionId): Promise<Session | null> {
    try {
      const raw = await readFile(join(this.dir, `${id}.json`), "utf8");
      return parseSession(raw);
    } catch {
      return null;
    }
  }

  async save(session: Session): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, `${session.id}.json`), serializeSession(session), "utf8");
  }

  async list(): Promise<SessionSummary[]> {
    try {
      const names = await readdir(this.dir);
      const out: SessionSummary[] = [];
      for (const n of names) {
        if (!n.endsWith(".json")) continue;
        const s = await this.load(n.replace(/\.json$/, ""));
        if (s) out.push({ id: s.id, goal: s.goal, lastUrl: s.lastUrl });
      }
      return out;
    } catch {
      return [];
    }
  }
}
