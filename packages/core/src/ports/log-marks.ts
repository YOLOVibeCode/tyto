import type { LogCounts } from "../brief/types.ts";

/** Per-session log offsets taken when a page is opened, so a brief covers only that page. */
export interface LogMarks {
  get(session: string): Promise<LogCounts>;
  set(session: string, counts: LogCounts): Promise<void>;
}
