import type { Session, SessionId, SessionSummary } from "../types.ts";

export interface SessionStore {
  load(id: SessionId): Promise<Session | null>;
  save(session: Session): Promise<void>;
  list(): Promise<SessionSummary[]>;
}
