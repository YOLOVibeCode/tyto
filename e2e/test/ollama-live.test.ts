/**
 * Tier 4 — Nightly real-model test against local Ollama.
 * Requires: TYTO_MODEL_LIVE=1 (plus a running Ollama instance)
 * Run with: TYTO_MODEL_LIVE=1 npm run test:e2e
 *
 * Catches prompt/format drift between the model and the plan parser.
 * Never gates merges. Non-required CI job.
 */
import { describe, expect, it } from "vitest";
import { coercePlan } from "@tyto/core";
import { OpenAiCompatModel, OpenAiCatalog } from "@tyto/llm";

const MODEL_LIVE = process.env.TYTO_MODEL_LIVE === "1";
const OLLAMA_BASE = process.env.TYTO_BASE_URL ?? "http://127.0.0.1:11434/v1";
const OLLAMA_MODEL = process.env.TYTO_MODEL ?? "llama3.2:latest";

describe.skipIf(!MODEL_LIVE)("ollama live — real model round-trip", () => {
  it("models.list returns at least one model from Ollama", async () => {
    const catalog = new OpenAiCatalog();
    const models = await catalog.list(new URL(OLLAMA_BASE), "");
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
  });

  it("single-step session: model returns a parseable plan", async () => {
    const model = new OpenAiCompatModel({
      baseUrl: new URL(OLLAMA_BASE),
      apiKey: "",
      model: OLLAMA_MODEL,
    });

    const result = await model.complete({
      system: `You are a browser automation planner. Output ONLY a JSON object:
{"rationale":"<brief>","anchors":[],"steps":[{"op":"done","reason":"<brief>"}]}
No markdown. No extra text.`,
      user: "The page is https://example.com/ and the goal is: extract the page heading.",
    });

    expect(typeof result.text).toBe("string");
    const plan = coercePlan(result.text);
    expect(plan).not.toBeNull();
    expect(plan?.steps.length).toBeGreaterThan(0);
  });
});
