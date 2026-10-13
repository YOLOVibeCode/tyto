/** The agent-browser binary could not be found or started. */
export class AgentBrowserMissingError extends Error {
  constructor(message = "agent-browser is not installed or not on PATH") {
    super(message);
    this.name = "AgentBrowserMissingError";
  }
}

/** agent-browser printed something that is not the expected JSON. */
export class BatchOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BatchOutputError";
  }
}
