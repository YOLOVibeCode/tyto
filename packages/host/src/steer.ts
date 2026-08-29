/** Default start path is one Chrome (Perch as a tab). OS-open is an opt-in escape hatch. */
export function osOpenPerchEnabled(env: NodeJS.ProcessEnv): boolean {
  if (env.TYTO_NO_OPEN === "1") return false;
  return env.TYTO_STEER === "os";
}
