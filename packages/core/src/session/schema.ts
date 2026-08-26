import type { Origin, Plan, Recipe, Session, SessionId, Step, VaultHandle } from "../types.ts";

const EPHEMERAL_KEYS = new Set([
  "ref_N",
  "backendNodeId",
  "box",
  "screenshot",
  "apiKey",
  "cookies",
  "token",
  "Set-Cookie",
]);

export function emptySession(id: SessionId, goal: string): Session {
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

export function serializeSession(session: Session): string {
  const recipes = session.recipes.map((r) => stripRecipe(r));
  const body = {
    id: session.id,
    goal: session.goal,
    messages: session.messages,
    plan: session.plan,
    recipes,
    answers: session.answers,
    lastUrl: session.lastUrl,
    allowlist: session.allowlist,
    model: { id: session.model.id, baseUrl: session.model.baseUrl },
    vaultHandles: session.vaultHandles,
    remainingSteps: session.remainingSteps,
  };
  return JSON.stringify(body);
}

export function parseSession(raw: string): Session {
  const data = JSON.parse(raw) as Record<string, unknown>;
  for (const k of EPHEMERAL_KEYS) {
    if (k in data) delete data[k];
  }
  const recipes = Array.isArray(data.recipes)
    ? (data.recipes as Recipe[]).map(stripRecipe)
    : [];
  const vaultHandles = isHandleMap(data.vaultHandles) ? data.vaultHandles : {};
  const modelIn = data.model as { id?: string; baseUrl?: string; apiKey?: string } | undefined;
  return {
    id: String(data.id ?? ""),
    goal: String(data.goal ?? ""),
    messages: Array.isArray(data.messages) ? (data.messages as Session["messages"]) : [],
    plan: (data.plan as Plan | null) ?? null,
    recipes,
    answers: Array.isArray(data.answers) ? (data.answers as string[]) : [],
    lastUrl: data.lastUrl == null ? null : String(data.lastUrl),
    allowlist: Array.isArray(data.allowlist) ? (data.allowlist as Origin[]) : [],
    model: { id: String(modelIn?.id ?? ""), baseUrl: String(modelIn?.baseUrl ?? "") },
    vaultHandles,
    remainingSteps: Array.isArray(data.remainingSteps)
      ? (data.remainingSteps as Step[])
      : [],
  };
}

function stripRecipe(r: Recipe): Recipe {
  const { role, name, landmark, origin, routePattern } = r;
  return { role, name, ...(landmark ? { landmark } : {}), origin, ...(routePattern ? { routePattern } : {}) };
}

function isHandleMap(v: unknown): v is Record<Origin, VaultHandle> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
