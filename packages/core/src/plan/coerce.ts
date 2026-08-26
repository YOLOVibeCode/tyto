import type { Plan, Step } from "../types.ts";

function coerceStep(raw: unknown): Step | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const op = String(o.op ?? o.action ?? "").toLowerCase();
  const name = String(o.name ?? o.label ?? "").trim();
  const role = String(o.role ?? "button").trim();
  const refMatch = String(o.ref ?? o.target ?? "").match(/ref_\d+/);
  const ref = refMatch ? refMatch[0] : undefined;
  if (op === "click" || op === "click_element") {
    return { op: "click", role, name, ...(ref ? { ref } : {}) };
  }
  if (op === "fill" || op === "type") {
    return { op: "fill", role, name, text: String(o.text ?? o.value ?? ""), ...(ref ? { ref } : {}) };
  }
  if (op === "press") return { op: "press", key: String(o.key ?? "Enter") };
  if (op === "extract") return { op: "extract", query: String(o.query ?? o.name ?? "") };
  if (op === "done") return { op: "done", reason: String(o.reason ?? "done") };
  return null;
}

export function coercePlan(raw: unknown): Plan | null {
  if (typeof raw === "string") {
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const json = fence?.[1] ?? raw;
    try {
      return coercePlan(JSON.parse(json));
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const stepsIn = Array.isArray(o.steps) ? o.steps : [];
  const steps = stepsIn.map(coerceStep).filter((s): s is Step => s !== null);
  if (steps.length === 0) return null;
  const anchors = Array.isArray(o.anchors)
    ? (o.anchors as Array<{ id?: string; role?: string; name?: string }>)
        .filter((a) => a && a.role && a.name)
        .map((a) => ({ id: String(a.id ?? a.name), role: String(a.role), name: String(a.name) }))
    : [];
  return { rationale: String(o.rationale ?? ""), anchors, steps };
}
