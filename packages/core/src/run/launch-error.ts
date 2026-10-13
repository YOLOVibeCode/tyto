const LAUNCH = [
  /Chrome exited early/i,
  /Auto-launch failed/i,
  /DevToolsActivePort/i,
  /Failed to (?:launch|start) (?:the )?browser/i,
  /browser (?:launch|start(?:up)?) failed/i,
];

/** Browser failed to start — worth one retry. Anything else (element not found, timeouts) is a real miss. */
export function isLaunchError(message: string | null): boolean {
  return message !== null && LAUNCH.some((re) => re.test(message));
}
