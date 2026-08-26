import { blankSession, TytoClient } from "@tyto/sdk";

export type PerchOpts = {
  client: TytoClient;
  startLoop: (sessionId: string) => Promise<void>;
};

/** Sidebar view of the prompt session. Session file is the source of truth. */
export class PerchController {
  constructor(private readonly opts: PerchOpts) {}

  async paste(goal: string, sessionId: string): Promise<string> {
    await this.opts.client.call("session.save", { session: blankSession(sessionId, goal) });
    await this.opts.startLoop(sessionId);
    return sessionId;
  }

  async resume(sessionId: string): Promise<unknown> {
    return this.opts.client.call("session.open", { id: sessionId });
  }

  async stop(): Promise<void> {
    await this.opts.client.call("operator.interrupt");
  }

  /** Drop this view. Must not delete the session file. */
  dispose(): void {}
}
