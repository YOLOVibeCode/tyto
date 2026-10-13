export type Release = () => Promise<void>;

/** One replay per agent-browser session at a time. `null` means the session stayed busy. */
export interface SessionLock {
  acquire(session: string, waitMs: number): Promise<Release | null>;
}
