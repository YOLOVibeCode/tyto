/** `tyto run` exit codes (sysexits-style). */
export const EXIT = {
  hit: 0,
  miss: 3,
  usage: 64,
  invalid: 65,
  unavailable: 69,
  internal: 70,
  busy: 75,
  notApproved: 77,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
