export function blankSession(id: string, goal: string): {
  id: string;
  goal: string;
  messages: Array<{ role: "user"; content: string }>;
  plan: null;
  recipes: [];
  answers: [];
  lastUrl: null;
  allowlist: [];
  model: { id: string; baseUrl: string };
  vaultHandles: Record<string, string>;
  remainingSteps: [];
} {
  return {
    id,
    goal,
    messages: [{ role: "user", content: goal }],
    plan: null,
    recipes: [],
    answers: [],
    lastUrl: null,
    allowlist: [],
    model: { id: "", baseUrl: "" },
    vaultHandles: {},
    remainingSteps: [],
  };
}
