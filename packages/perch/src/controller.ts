import { blankSession, TytoClient } from "@tyto/sdk";

export type PerchOpts = {
  client: TytoClient;
};

export type FrameRef = { tabId: string; frameId: string; origin: string };

/** Sidebar view of the prompt session. Session file is the source of truth. */
export class PerchController {
  constructor(private readonly opts: PerchOpts) {}

  async paste(goal: string, sessionId: string): Promise<string> {
    await this.opts.client.call("session.save", { session: blankSession(sessionId, goal) });
    await this.opts.client.call("session.run", { id: sessionId });
    return sessionId;
  }

  async go(input: { url: string; goal: string; sessionId?: string }): Promise<string> {
    const parsed = new URL(input.url);
    const id = input.sessionId ?? "session";
    const origin = parsed.origin;
    await this.opts.client.call("operator.grantOrigin", { origin });
    await this.opts.client.call("page.goto", { url: parsed.href });
    await this.opts.client.call("session.save", {
      session: {
        ...blankSession(id, input.goal),
        lastUrl: parsed.href,
        allowlist: [origin],
      },
    });
    await this.opts.client.call("session.run", {
      id,
      frame: { tabId: "t", frameId: "main", origin },
    });
    return id;
  }

  /** Set the active model id on the session and persist it. */
  async setModel(sessionId: string, modelId: string): Promise<void> {
    const session = (await this.opts.client.call("session.open", { id: sessionId })) as {
      id: string;
      goal: string;
      messages: unknown[];
      plan: unknown;
      recipes: unknown[];
      answers: unknown[];
      lastUrl: string | null;
      allowlist: string[];
      model: { id: string; baseUrl: string };
      vaultHandles: Record<string, unknown>;
      remainingSteps: unknown[];
    };
    await this.opts.client.call("session.save", {
      session: { ...session, model: { id: modelId, baseUrl: "" } },
    });
  }

  /** Run the session against the given frame (called by the Send button). */
  async send(sessionId: string, frame: FrameRef): Promise<void> {
    await this.opts.client.call("session.run", { id: sessionId, frame });
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
