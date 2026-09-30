import { describe, expect, it } from "vitest";
import { ClaudeCodeCompiler, OpenAiCompatCompiler } from "@tyto/compiler";
import { selectCompiler } from "../src/index.ts";

const OPTS = { tytoBin: "/tyto/bin/tyto.mjs", workRoot: "/tmp/tyto-compile" };

describe("selectCompiler", () => {
  it("config selects the compiler: claude (default) or openai with baseUrl and model", () => {
    expect(selectCompiler({}, OPTS)).toBeInstanceOf(ClaudeCodeCompiler);
    expect(selectCompiler({ TYTO_COMPILER: "claude" }, OPTS)).toBeInstanceOf(ClaudeCodeCompiler);
    const openai = selectCompiler({ TYTO_COMPILER: "openai", TYTO_BASE_URL: "http://127.0.0.1:11434/v1", TYTO_MODEL: "qwen3-coder:30b" }, OPTS);
    expect(openai).toBeInstanceOf(OpenAiCompatCompiler);
  });

  it("openai without a base URL or model is a clear error", () => {
    expect(() => selectCompiler({ TYTO_COMPILER: "openai", TYTO_MODEL: "m" }, OPTS)).toThrow(/TYTO_BASE_URL/);
    expect(() => selectCompiler({ TYTO_COMPILER: "openai", TYTO_BASE_URL: "http://x.test/v1" }, OPTS)).toThrow(/TYTO_MODEL/);
    expect(() => selectCompiler({ TYTO_COMPILER: "gemini" }, OPTS)).toThrow(/claude or openai/);
  });
});
