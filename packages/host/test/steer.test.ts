import { describe, expect, it } from "vitest";
import { osOpenPerchEnabled } from "../src/steer.ts";

describe("one-browser start path", () => {
  it("does not OS-open Perch unless TYTO_STEER=os", () => {
    expect(osOpenPerchEnabled({})).toBe(false);
    expect(osOpenPerchEnabled({ TYTO_STEER: "chrome" })).toBe(false);
    expect(osOpenPerchEnabled({ TYTO_STEER: "os" })).toBe(true);
    expect(osOpenPerchEnabled({ TYTO_STEER: "os", TYTO_NO_OPEN: "1" })).toBe(false);
    expect(osOpenPerchEnabled({ TYTO_NO_OPEN: "1" })).toBe(false);
  });
});
