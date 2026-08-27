import { describe, expect, it } from "vitest";
import { composeFromEnv } from "../src/main.ts";

describe("host composition root", () => {
  it("composeFromEnv binds 127.0.0.1 and refuses 0.0.0.0", () => {
    const token = "t".repeat(32);
    const cfg = composeFromEnv({ TYTO_HOST_TOKEN: token });
    expect(cfg.bind).toBe("127.0.0.1");
    expect(cfg.token).toBe(token);
    expect(() => composeFromEnv({ TYTO_HOST_TOKEN: token, TYTO_BIND: "0.0.0.0" })).toThrow(/bind refused/i);
  });

  it("composeFromEnv refuses a missing host token", () => {
    expect(() => composeFromEnv({})).toThrow(/TYTO_HOST_TOKEN/i);
    expect(() => composeFromEnv({ TYTO_HOST_TOKEN: "" })).toThrow(/TYTO_HOST_TOKEN/i);
  });

  it("composeFromEnv attaches a launcher (spawn still opt-in)", () => {
    const cfg = composeFromEnv({ TYTO_HOST_TOKEN: "t".repeat(32) });
    expect(cfg.launcher).toBeDefined();
    expect(cfg.models).toBeDefined();
  });
});
